/**
 * LSV Packer – packt Dateien zurück in ein LSV-Paket
 * Verwendet Manifest von unpack (--manifest) für exakte Roundtrip-Kompatibilität
 * Unterstützt DOS2 (v13) und BG3 (v15/v16/v18)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compress } from "./compression.js";
import { LSPK_SIGNATURE } from "./types.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { writeLsfToBuffer } from "../lsf/writer.js";

const FILE_ENTRY_10_SIZE = 280;
const FILE_ENTRY_18_SIZE = 272;
const COMPRESSION_LZ4 = 2;
/** DOS2 v13: Dateien sind auf 64-Byte-Grenzen ausgerichtet (wie Original) */
const LSPK_ALIGNMENT = 64;

function writeU32(buf: Buffer, offset: number, val: number): void {
	buf.writeUInt32LE(val, offset);
}

function writeU64(buf: Buffer, offset: number, val: number): void {
	buf.writeBigUInt64LE(BigInt(val), offset);
}

function padNullTerminated(str: string, maxLen: number): Buffer {
	const b = Buffer.alloc(maxLen, 0);
	const enc = Buffer.from(str, "utf8");
	enc.copy(b, 0, 0, Math.min(enc.length, maxLen - 1));
	return b;
}

interface FileEntry {
	name: string;
	flags: number;
	uncompressedSize: number;
	archivePart?: number;
}

/** DOS2 LSV: Zlib für alle Dateien (wie Divine/LSLib) */
const DEFAULT_LSV_FLAGS = 33; // Zlib + DefaultCompress

/** Verzeichnis rekursiv scannen (wie Divine), versteckte Dateien auslassen */
function scanDirectory(dir: string): string[] {
	const files: string[] = [];
	function walk(base: string) {
		for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
			const rel = base ? `${base}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!entry.name.startsWith(".")) walk(rel);
			} else if (entry.isFile()) {
				if (!rel.split("/").some((p) => p.startsWith("."))) {
					files.push(rel.replace(/\\/g, "/"));
				}
			}
		}
	}
	walk("");
	return files.sort();
}

function buildFileListDOS2(files: FileEntry[], offsets: number[], sizesOnDisk: number[]): Buffer {
	const numFiles = files.length;
	const buf = Buffer.alloc(numFiles * FILE_ENTRY_10_SIZE);
	for (let i = 0; i < numFiles; i++) {
		const f = files[i];
		const o = i * FILE_ENTRY_10_SIZE;
		padNullTerminated(f.name, 256).copy(buf, o);
		writeU32(buf, o + 256, offsets[i]);
		writeU32(buf, o + 260, sizesOnDisk[i]);
		writeU32(buf, o + 264, f.uncompressedSize || sizesOnDisk[i]);
		writeU32(buf, o + 268, f.archivePart ?? 0);
		writeU32(buf, o + 272, f.flags);
	}
	return buf;
}

function buildFileListBG3(files: FileEntry[], offsets: number[], sizesOnDisk: number[], dataStartOffset: number): Buffer {
	const numFiles = files.length;
	const buf = Buffer.alloc(numFiles * FILE_ENTRY_18_SIZE);
	for (let i = 0; i < numFiles; i++) {
		const f = files[i];
		const o = i * FILE_ENTRY_18_SIZE;
		padNullTerminated(f.name, 256).copy(buf, o);
		writeU32(buf, o + 256, dataStartOffset + offsets[i]);
		buf.writeUInt16LE(0, o + 260);
		buf.writeUInt8(f.archivePart ?? 0, o + 262);
		buf.writeUInt8(f.flags, o + 263);
		writeU32(buf, o + 264, sizesOnDisk[i]);
		writeU32(buf, o + 268, f.uncompressedSize || sizesOnDisk[i]);
	}
	return buf;
}

export interface PackLsvOptions {
	/** LSV-Version: 13=DOS2, 15/16/18=BG3. Default 13. */
	version?: number;
}

/**
 * Packt ein Verzeichnis (LSF-Dateien) zurück in eine LSV-Datei.
 * Scannt Verzeichnis, Zlib für alle (wie Divine).
 */
export function packLsv(inputDir: string, outputPath: string, options?: PackLsvOptions): void {
	const version = options?.version ?? 13;
	const isBG3 = version === 15 || version === 16 || version === 18;
	const useAlignment = !isBG3;

	const dataChunks: Buffer[] = [];
	const offsets: number[] = [];
	const sizesOnDisk: number[] = [];
	let offset = 0;

	const filesToPack: FileEntry[] = scanDirectory(inputDir).map((name) => ({
		name,
		flags: DEFAULT_LSV_FLAGS,
		uncompressedSize: 0,
		archivePart: 0
	}));

	for (const f of filesToPack) {
		const filePath = join(inputDir, f.name);
		if (!existsSync(filePath)) {
			throw new Error(`Datei nicht gefunden: ${filePath}`);
		}
		const raw = readFileSync(filePath);
		const uncompressedSize = raw.length;
		const compressed = f.flags === 0 ? raw : compress(raw, f.flags);
		f.uncompressedSize = uncompressedSize;
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		if (useAlignment) {
			const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
			const padding = aligned - offset - compressed.length;
			dataChunks.push(compressed);
			if (padding > 0) {
				dataChunks.push(Buffer.alloc(padding, 0));
			}
			offset = aligned;
		} else {
			offset += compressed.length;
			dataChunks.push(compressed);
		}
	}
	const dataBlock = Buffer.concat(dataChunks);

	const bg3DataStart = 40;
	const fileList = isBG3 ? buildFileListBG3(filesToPack, offsets, sizesOnDisk, bg3DataStart) : buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
	const compressedFileList = compress(fileList, COMPRESSION_LZ4);
	if (compressedFileList.length > fileList.length) {
		throw new Error(`File list compression fehlgesch: komprimiert ${compressedFileList.length} > unkomprimiert ${fileList.length}`);
	}
	const numFilesBuf = Buffer.alloc(4);
	writeU32(numFilesBuf, 0, filesToPack.length);
	const fileListRaw = Buffer.concat([numFilesBuf, compressedFileList]);

	const fileListOffset = dataBlock.length;
	const fileListSize = isBG3 ? 4 + 4 + compressedFileList.length : fileListRaw.length;

	let output: Buffer;

	if (isBG3) {
		const header = Buffer.alloc(40);
		writeU32(header, 0, LSPK_SIGNATURE);
		writeU32(header, 4, version);
		writeU64(header, 8, bg3DataStart + dataBlock.length);
		writeU32(header, 16, fileListSize);
		header.writeUInt8(0, 20);
		header.writeUInt8(0, 21);
		header.fill(0, 22, 38);
		header.writeUInt16LE(1, 38);

		const numFilesBuf = Buffer.alloc(4);
		writeU32(numFilesBuf, 0, filesToPack.length);
		const compressedSizeBuf = Buffer.alloc(4);
		writeU32(compressedSizeBuf, 0, compressedFileList.length);

		output = Buffer.concat([header, dataBlock, numFilesBuf, compressedSizeBuf, compressedFileList]);
	} else {
		// DOS2 v13: Trailer am Ende
		const header = Buffer.alloc(32);
		writeU32(header, 0, version);
		writeU32(header, 4, fileListOffset);
		writeU32(header, 8, fileListSize);
		header.writeUInt16LE(1, 12);

		const trailerSize = 40;
		const trailer = Buffer.alloc(trailerSize);
		header.copy(trailer, 0, 0, 32);
		writeU32(trailer, 32, trailerSize);
		writeU32(trailer, 36, LSPK_SIGNATURE);

		output = Buffer.concat([dataBlock, fileListRaw, trailer]);
	}

	writeFileSync(outputPath, output);
}

/**
 * Packt ein Verzeichnis mit LSX-Dateien (+ PNG etc.) zurück in eine LSV-Datei.
 * LSX → LSF konvertiert, andere Dateien unverändert. Scannt Verzeichnis (wie Divine).
 */
export function packLsvFromLsx(inputDir: string, outputPath: string, options?: PackLsvOptions): void {
	const version = options?.version ?? 13;
	const isBG3 = version === 15 || version === 16 || version === 18;
	const useAlignment = !isBG3;

	const scanned = scanDirectory(inputDir);
	const filesToPack: FileEntry[] = [];
	const dataChunks: Buffer[] = [];
	const offsets: number[] = [];
	const sizesOnDisk: number[] = [];
	let offset = 0;

	for (const rel of scanned) {
		const filePath = join(inputDir, rel);
		let raw: Buffer;
		let packageName: string;
		if (rel.toLowerCase().endsWith(".lsx")) {
			const { root, version: lsxVersion } = parseLsx(filePath);
			const lsxOpts = lsxVersion.major >= 4 ? undefined : { metadataFormat: 0 };
			raw = writeLsfToBuffer(root, lsxVersion, lsxOpts);
			packageName = rel.replace(/\.lsx$/i, ".lsf");
		} else {
			raw = readFileSync(filePath);
			packageName = rel;
		}
		filesToPack.push({
			name: packageName,
			flags: DEFAULT_LSV_FLAGS,
			uncompressedSize: raw.length,
			archivePart: 0
		});
		const compressed = compress(raw, DEFAULT_LSV_FLAGS);
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		if (useAlignment) {
			const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
			const padding = aligned - offset - compressed.length;
			dataChunks.push(compressed);
			if (padding > 0) {
				dataChunks.push(Buffer.alloc(padding, 0));
			}
			offset = aligned;
		} else {
			offset += compressed.length;
			dataChunks.push(compressed);
		}
	}

	const dataBlock = Buffer.concat(dataChunks);

	const bg3DataStart = 40;
	const fileList = isBG3 ? buildFileListBG3(filesToPack, offsets, sizesOnDisk, bg3DataStart) : buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
	const compressedFileList = compress(fileList, COMPRESSION_LZ4);

	const fileListOffset = dataBlock.length;
	const fileListSize = isBG3 ? 4 + 4 + compressedFileList.length : 4 + compressedFileList.length;

	if (compressedFileList.length > fileList.length) {
		throw new Error(`File list compression fehlgesch: komprimiert ${compressedFileList.length} > unkomprimiert ${fileList.length}`);
	}

	const numFilesBuf = Buffer.alloc(4);
	writeU32(numFilesBuf, 0, filesToPack.length);

	let output: Buffer;

	if (isBG3) {
		const header = Buffer.alloc(40);
		writeU32(header, 0, LSPK_SIGNATURE);
		writeU32(header, 4, version);
		writeU64(header, 8, bg3DataStart + dataBlock.length);
		writeU32(header, 16, fileListSize);
		header.writeUInt8(0, 20);
		header.writeUInt8(0, 21);
		header.fill(0, 22, 38);
		header.writeUInt16LE(1, 38);

		const compressedSizeBuf = Buffer.alloc(4);
		writeU32(compressedSizeBuf, 0, compressedFileList.length);

		output = Buffer.concat([header, dataBlock, numFilesBuf, compressedSizeBuf, compressedFileList]);
	} else {
		const header = Buffer.alloc(32);
		writeU32(header, 0, version);
		writeU32(header, 4, fileListOffset);
		writeU32(header, 8, fileListSize);
		header.writeUInt16LE(1, 12);

		const trailerSize = 40;
		const trailer = Buffer.alloc(trailerSize);
		header.copy(trailer, 0, 0, 32);
		writeU32(trailer, 32, trailerSize);
		writeU32(trailer, 36, LSPK_SIGNATURE);

		output = Buffer.concat([dataBlock, numFilesBuf, compressedFileList, trailer]);
	}

	writeFileSync(outputPath, output);
}
