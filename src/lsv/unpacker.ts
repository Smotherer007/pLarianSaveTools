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
const FILE_ENTRY_18_SIZE = 272; // 256 + 4+2+1+1+4+4 (Name, Off1, Off2, Part, Flags, SizeDisk, SizeUncomp)
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
	/** true für BG3 (v15/v16/v18) mit Header am Anfang */
	headerAtStart?: boolean;
}

function readHeader(data: Buffer): { header: PackageHeader; headerOffset: number } {
	const fileSize = data.length;

	// BG3/v10+ format: Signature am Anfang (offset 0)
	const sigAtStart = readU32(data, 0);
	if (sigAtStart === LSPK_SIGNATURE && fileSize >= 44) {
		const version = readU32(data, 4);
		if (version === 15 || version === 16 || version === 18) {
			// LSPKHeader16: Version(4), FileListOffset(8), FileListSize(4), Flags(1), Priority(1), Md5(16), NumParts(2)
			const fileListOffset = Number(readU64(data, 8));
			const fileListSize = readU32(data, 16);
			const numParts = data.readUInt16LE(38);

			return {
				header: {
					version,
					fileListOffset,
					fileListSize,
					numParts,
					numFiles: 0,
					headerAtStart: true
				},
				headerOffset: 0
			};
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

	const header: PackageHeader = {
		version: readU32(headerBuf, 0),
		fileListOffset: readU32(headerBuf, 4),
		fileListSize: readU32(headerBuf, 8),
		numParts: headerBuf.readUInt16LE(10),
		numFiles: 0
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

	// BG3 v18: FileEntry18 (272 bytes). DOS2 v13: FileEntry10/15
	const expSize = header.version === 18 ? numFiles * FILE_ENTRY_18_SIZE : numFiles * FILE_ENTRY_15_SIZE;
	const decompressed = decompress(compressed, expSize, COMPRESSION_LZ4);

	const entrySize = header.version === 18 ? FILE_ENTRY_18_SIZE : decompressed.length >= numFiles * FILE_ENTRY_15_SIZE ? FILE_ENTRY_15_SIZE : FILE_ENTRY_10_SIZE;

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

		if (entrySize === FILE_ENTRY_18_SIZE) {
			// FileEntry18: Name(256), Off1(4), Off2(2), Part(1), Flags(1), SizeDisk(4), SizeUncomp(4)
			offsetInFile = BigInt(readU32(entry, 256)) | (BigInt(entry.readUInt16LE(260)) << 32n);
			archivePart = entry[262];
			flags = entry[263];
			sizeOnDisk = readU32(entry, 264);
			uncompressedSize = readU32(entry, 268);
		} else if (entrySize === FILE_ENTRY_15_SIZE) {
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

	// v13/BG3: DataOffset = 0
	const dataOffset = header.headerAtStart || header.version > 10 ? 0 : header.fileListOffset + 32;

	const files = readFileListV13(data, header);
	return { files, data, header };
}

export interface UnpackOptions {
	filter?: (name: string) => boolean;
	/** Manifest speichern für pack (Roundtrip) */
	manifest?: boolean;
}

/**
 * Unpack LSV savegame file to directory
 * Extracts all LSF/LSB files which can then be converted to LSX
 */
export function unpackLsv(inputPath: string, outputDir: string, options?: UnpackOptions): string[] {
	const { files, data, header } = readPackage(inputPath);
	const dataOffset = 0; // v13 format

	const extracted: string[] = [];

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
	}

	if (options?.manifest) {
		const manifest = {
			version: header.version ?? 13,
			files: files.map((f) => ({
				name: f.name,
				flags: f.flags,
				uncompressedSize: f.uncompressedSize,
				archivePart: f.archivePart
			}))
		};
		writeFileSync(join(outputDir, ".lsv.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
	}

	return extracted;
}
