/**
 * LSV (Larian Savegame) Package Unpacker
 * Unpacks DOS2 savegame files to extract LSF/LSB files
 *
 * Based on Norbyte's LSLib: https://github.com/Norbyte/lslib
 */

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decompress } from "./compression.js";
import type { PackagedFileInfo } from "./types.js";

const LSPK_SIGNATURE = 0x4b50534c;
const FILE_ENTRY_10_SIZE = 280; // 256 + 4+4+4+4+4+4 (Name, Offset, SizeDisk, SizeUncomp, Part, Flags, Crc)
const FILE_ENTRY_15_SIZE = 304; // 256 + 8+8+8 + 4+4+4+4
const COMPRESSION_LZ4 = 2;

function readU32(buf: Buffer, offset: number): number {
	return buf.readUInt32LE(offset);
}

function readU64(buf: Buffer, offset: number): bigint {
	return buf.readBigUInt64LE(offset);
}

function nullTerminatedString(buf: Buffer): string {
	let end = 0;
	while (end < buf.length && buf[end] !== 0) end++;
	return buf.subarray(0, end).toString("utf-8");
}

interface PackageHeader {
	version: number;
	fileListOffset: number;
	fileListSize: number;
	numParts: number;
	numFiles: number;
	flags?: number;
	priority?: number;
	/** true für v10+ mit Header am Anfang */
	headerAtStart?: boolean;
}

function readHeader(data: Buffer): { header: PackageHeader; headerOffset: number } {
	const fileSize = data.length;

	// v10+ format (BG3 etc.): nicht unterstützt – nur DOS2
	const sigAtStart = readU32(data, 0);
	if (sigAtStart === LSPK_SIGNATURE && fileSize >= 44) {
		const version = readU32(data, 4);
		if (version === 15 || version === 16 || version === 18) {
			throw new Error("BG3/v10+ LSV-Format wird nicht unterstützt. Nur DOS2 (v13).");
		}
	}

	// DOS2 v13+ format: Trailer am Ende = [LSPKHeader32][headerSize4][signature4]
	const headerSize = readU32(data, fileSize - 8);
	const signature = readU32(data, fileSize - 4);

	if (signature !== LSPK_SIGNATURE) {
		throw new Error(`Invalid LSV signature: expected LSPK (0x${LSPK_SIGNATURE.toString(16)}), got 0x${signature.toString(16)}`);
	}

	const headerOffset = fileSize - headerSize;
	const headerBuf = data.subarray(headerOffset, headerOffset + 32);

	// LSPKHeader13: Version(4), FileListOffset(4), FileListSize(4), NumParts(2), Flags(1), Priority(1), Md5(16)
	const header: PackageHeader = {
		version: readU32(headerBuf, 0),
		fileListOffset: readU32(headerBuf, 4),
		fileListSize: readU32(headerBuf, 8),
		numParts: headerBuf.readUInt16LE(12),
		numFiles: 0,
		flags: headerBuf[14],
		priority: headerBuf[15]
	};

	if (header.version >= 7 && header.version <= 10 && headerOffset === 0) {
		header.numFiles = readU32(headerBuf, header.version <= 9 ? 16 : 20);
	}

	return { header, headerOffset };
}

function readFileListV13(data: Buffer, header: PackageHeader): PackagedFileInfo[] {
	const offset = header.fileListOffset;
	if (offset >= data.length) {
		throw new Error(
			`Invalid file list offset ${offset} (file size: ${data.length}). ` +
				`Header: version=${header.version} fileListOffset=${header.fileListOffset} fileListSize=${header.fileListSize}`
		);
	}
	const numFiles = readU32(data, offset);
	const compressedSize = header.version > 13 ? readU32(data, offset + 4) : header.fileListSize - 4;

	const headerSize = header.version > 13 ? 8 : 4;
	const compressed = data.subarray(offset + headerSize, offset + headerSize + compressedSize);

	// DOS2 v13: FileEntry10/15
	const expSize = numFiles * FILE_ENTRY_15_SIZE;
	const decompressed = decompress(compressed, expSize, COMPRESSION_LZ4);

	const entrySize = decompressed.length >= numFiles * FILE_ENTRY_15_SIZE ? FILE_ENTRY_15_SIZE : FILE_ENTRY_10_SIZE;

	if (decompressed.length < numFiles * entrySize) {
		throw new Error(`Decompressed file list too small: need ${numFiles * entrySize}, got ${decompressed.length}`);
	}

	const files: PackagedFileInfo[] = [];
	for (let i = 0; i < numFiles; i++) {
		const entryOffset = i * entrySize;
		const entry = decompressed.subarray(entryOffset, entryOffset + entrySize);

		const name = nullTerminatedString(entry.subarray(0, 256));

		let offsetInFile: bigint;
		let sizeOnDisk: number;
		let uncompressedSize: number;
		let archivePart: number;
		let flags: number;

		if (entrySize === FILE_ENTRY_15_SIZE) {
			offsetInFile = readU64(entry, 256);
			sizeOnDisk = Number(readU64(entry, 264));
			uncompressedSize = Number(readU64(entry, 272));
			archivePart = readU32(entry, entrySize - 12);
			flags = readU32(entry, entrySize - 8);
		} else {
			offsetInFile = BigInt(readU32(entry, 256));
			sizeOnDisk = readU32(entry, 260);
			uncompressedSize = readU32(entry, 264);
			archivePart = readU32(entry, entrySize - 12);
			flags = readU32(entry, entrySize - 8);
		}

		files.push({
			name,
			archivePart,
			offsetInFile,
			sizeOnDisk,
			uncompressedSize: uncompressedSize || sizeOnDisk,
			flags
		});
	}

	return files;
}

function extractFile(data: Buffer, file: PackagedFileInfo, dataOffset: number): Buffer {
	const offset = Number(file.offsetInFile);
	const size = file.sizeOnDisk;
	const uncompressedSize = file.uncompressedSize;

	// Deletion marker (from LSLib)
	if ((file.offsetInFile & 0x0000ffffffffffffn) === 0xbeefdeadbeefn) {
		throw new Error(`File ${file.name} is marked as deleted`);
	}

	if (file.archivePart === 0) {
		const actualOffset = offset + dataOffset;
		if (actualOffset + size > data.length) {
			throw new Error(`File ${file.name}: offset ${actualOffset} + size ${size} exceeds file length ${data.length}`);
		}
		const chunk = data.subarray(actualOffset, actualOffset + size);

		if (file.flags === 0 || uncompressedSize === 0) {
			return chunk;
		}
		return decompress(chunk, uncompressedSize, file.flags);
	}

	throw new Error(`Multi-part packages (part ${file.archivePart}) not yet supported`);
}

/** Extrahiert den Inhalt einer einzelnen Datei aus dem Package (für Konvertierung). */
export function extractFileContent(data: Buffer, file: PackagedFileInfo, dataOffset: number): Buffer {
	return extractFile(data, file, dataOffset);
}

/**
 * Read LSV package and return list of contained files with their metadata
 */
export function readPackage(inputPath: string): {
	files: PackagedFileInfo[];
	data: Buffer;
	header: PackageHeader;
} {
	const data = readFileSync(inputPath);
	const { header } = readHeader(data);

	const files = readFileListV13(data, header);
	return { files, data, header };
}

export interface UnpackOptions {
	filter?: (name: string) => boolean;
	/** Manifest für Roundtrip schreiben (default: true) */
	manifest?: boolean;
}

const MANIFEST_NAME = "__manifest__.json";

/**
 * Unpack LSV savegame file to directory
 * Extracts all LSF/LSB files which can then be converted to LSX
 * Schreibt __manifest__.json mit Dateireihenfolge für byte-identischen Pack-Roundtrip (LSLib-kompatibel)
 */
export function unpackLsv(inputPath: string, outputDir: string, options?: UnpackOptions): string[] {
	const { files, data, header } = readPackage(inputPath);
	const dataOffset = 0; // v13 format
	const writeManifest = options?.manifest !== false;

	const extracted: string[] = [];
	const manifestFiles: string[] = [];

	for (const file of files) {
		if (options?.filter && !options.filter(file.name)) {
			continue;
		}

		const outPath = join(outputDir, file.name);
		const outDir = dirname(outPath);
		mkdirSync(outDir, { recursive: true });

		const content = extractFile(data, file, dataOffset);
		writeFileSync(outPath, content, { flag: "w" });
		extracted.push(outPath);
		manifestFiles.push(file.name);
	}

	if (writeManifest && manifestFiles.length > 0) {
		const manifestPath = join(outputDir, MANIFEST_NAME);
		const manifest: { version: number; flags?: number; priority?: number; files: { name: string; flags: number }[] } = {
			version: header.version,
			files: manifestFiles.map((name) => {
				const f = files.find((x) => x.name === name);
				return { name, flags: f?.flags ?? 33 };
			})
		};
		if (header.flags !== undefined) manifest.flags = header.flags;
		if (header.priority !== undefined) manifest.priority = header.priority;
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 0), "utf8");
	}

	return extracted;
}
