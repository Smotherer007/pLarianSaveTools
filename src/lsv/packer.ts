/**
 * LSV Packer – packt Dateien zurück in ein LSV-Paket
 * LSLib-kompatibel: FileEntry15 für v13, Padding 0xAD, CRC32, Manifest-Reihenfolge
 * Unterstützt DOS2 (v13) und BG3 (v15/v16/v18)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compress } from "./compression.js";
import { LSPK_SIGNATURE } from "./types.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { writeLsfToBuffer } from "../lsf/writer.js";

const FILE_ENTRY_10_SIZE = 280;
const FILE_ENTRY_15_SIZE = 304; // LSLib: Name(256)+Offset(8)+SizeDisk(8)+Uncomp(8)+Part(4)+Flags(4)+Crc(4)+Unknown2(4)
const FILE_ENTRY_18_SIZE = 272;
const COMPRESSION_LZ4 = 2;
/** DOS2 v13: 64-Byte-Alignment, Padding 0xAD (LSLib) */
const LSPK_ALIGNMENT = 64;
const LSPK_PADDING_BYTE = 0xad;
const MANIFEST_NAME = "__manifest__.json";

function writeU32(buf: Buffer, offset: number, val: number): void {
	buf.writeUInt32LE(val, offset);
}

function writeU64(buf: Buffer, offset: number, val: number): void {
	buf.writeBigUInt64LE(BigInt(val), offset);
}

/** CRC32 (IEEE) für LSLib v10–v16 Kompatibilität */
function crc32(buf: Buffer): number {
	let crc = 0xffffffff;
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	for (let i = 0; i < buf.length; i++) {
		crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
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
	crc?: number;
}

/** DOS2 LSV: Zlib für alle Dateien (wie Divine/LSLib) */
const DEFAULT_LSV_FLAGS = 33; // Zlib + DefaultCompress

interface ManifestFile {
	name: string;
	flags?: number;
}

interface ScanResult {
	files: ManifestFile[];
	headerFlags?: number;
	headerPriority?: number;
}

/** Verzeichnis scannen; nutzt __manifest__.json für Reihenfolge + Flags (LSLib-kompatibel) */
function scanDirectory(dir: string): ManifestFile[] {
	return scanDirectoryWithManifest(dir).files;
}

function scanDirectoryWithManifest(dir: string): ScanResult {
	const manifestPath = join(dir, MANIFEST_NAME);
	if (existsSync(manifestPath)) {
		try {
			const raw = readFileSync(manifestPath, "utf8");
			const manifest = JSON.parse(raw) as {
				version?: number;
				flags?: number;
				priority?: number;
				files?: string[] | { name: string; flags?: number }[];
			};
			if (Array.isArray(manifest.files) && manifest.files.length > 0) {
				const files = manifest.files
					.filter((f) => (typeof f === "string" ? f : f.name) !== MANIFEST_NAME)
					.map((f) =>
						typeof f === "string"
							? { name: f, flags: DEFAULT_LSV_FLAGS }
							: { name: f.name, flags: f.flags ?? DEFAULT_LSV_FLAGS }
					);
				return {
					files,
					headerFlags: manifest.flags,
					headerPriority: manifest.priority
				};
			}
		} catch {
			/* fallback */
		}
	}
	const fileNames: string[] = [];
	function walk(base: string) {
		for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
			const rel = base ? `${base}/${entry.name}` : entry.name;
			if (entry.name === MANIFEST_NAME) continue;
			if (entry.isDirectory()) {
				if (!entry.name.startsWith(".")) walk(rel);
			} else if (entry.isFile()) {
				if (!rel.split("/").some((p) => p.startsWith("."))) {
					fileNames.push(rel.replace(/\\/g, "/"));
				}
			}
		}
	}
	walk("");
	return { files: fileNames.sort().map((name) => ({ name, flags: DEFAULT_LSV_FLAGS })) };
}

/** FileEntry15 (304 B) – LSLib v13 Format mit CRC32 */
function buildFileListV13(
	files: FileEntry[],
	offsets: number[],
	sizesOnDisk: number[]
): Buffer {
	const numFiles = files.length;
	const buf = Buffer.alloc(numFiles * FILE_ENTRY_15_SIZE);
	for (let i = 0; i < numFiles; i++) {
		const f = files[i];
		const o = i * FILE_ENTRY_15_SIZE;
		padNullTerminated(f.name, 256).copy(buf, o);
		writeU64(buf, o + 256, offsets[i]);
		writeU64(buf, o + 264, sizesOnDisk[i]);
		writeU64(buf, o + 272, f.uncompressedSize || sizesOnDisk[i]);
		writeU32(buf, o + 280, f.archivePart ?? 0);
		writeU32(buf, o + 284, f.flags & 0x0f);
		writeU32(buf, o + 288, f.crc ?? 0);
		writeU32(buf, o + 292, 0);
	}
	return buf;
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

	const { files: scanned, headerFlags, headerPriority } = scanDirectoryWithManifest(inputDir);
	const filesToPack: FileEntry[] = scanned.map((m) => ({
		name: m.name,
		flags: m.flags ?? DEFAULT_LSV_FLAGS,
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
		if (version >= 10 && version <= 16) f.crc = crc32(compressed);
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		if (useAlignment) {
			const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
			const padding = aligned - offset - compressed.length;
			dataChunks.push(compressed);
			if (padding > 0) {
				dataChunks.push(Buffer.alloc(padding, LSPK_PADDING_BYTE));
			}
			offset = aligned;
		} else {
			offset += compressed.length;
			dataChunks.push(compressed);
		}
	}
	const dataBlock = Buffer.concat(dataChunks);

	const bg3DataStart = 40;
	const fileList = isBG3
		? buildFileListBG3(filesToPack, offsets, sizesOnDisk, bg3DataStart)
		: version === 13
			? buildFileListV13(filesToPack, offsets, sizesOnDisk)
			: buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
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
		// DOS2 v13: Trailer am Ende (LSPKHeader13: Version, FileListOffset, FileListSize, NumParts, Flags, Priority, Md5[16])
		const header = Buffer.alloc(32);
		writeU32(header, 0, version);
		writeU32(header, 4, fileListOffset);
		writeU32(header, 8, fileListSize);
		header.writeUInt16LE(1, 12); // NumParts
		header.writeUInt8(headerFlags ?? 0, 14); // Flags
		header.writeUInt8(headerPriority ?? 0, 15); // Priority
		header.fill(0, 16, 32); // Md5

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

	const { files: scanned, headerFlags, headerPriority } = scanDirectoryWithManifest(inputDir);
	const filesToPack: FileEntry[] = [];
	const dataChunks: Buffer[] = [];
	const offsets: number[] = [];
	const sizesOnDisk: number[] = [];
	let offset = 0;

	for (const m of scanned) {
		const rel = m.name;
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
		const flags = m.flags ?? DEFAULT_LSV_FLAGS;
		const compressed = compress(raw, flags);
		const entry: FileEntry = {
			name: packageName,
			flags,
			uncompressedSize: raw.length,
			archivePart: 0
		};
		if (version >= 10 && version <= 16) entry.crc = crc32(compressed);
		filesToPack.push(entry);
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		if (useAlignment) {
			const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
			const padding = aligned - offset - compressed.length;
			dataChunks.push(compressed);
			if (padding > 0) {
				dataChunks.push(Buffer.alloc(padding, LSPK_PADDING_BYTE));
			}
			offset = aligned;
		} else {
			offset += compressed.length;
			dataChunks.push(compressed);
		}
	}

	const dataBlock = Buffer.concat(dataChunks);

	const bg3DataStart = 40;
	const fileList = isBG3
		? buildFileListBG3(filesToPack, offsets, sizesOnDisk, bg3DataStart)
		: version === 13
			? buildFileListV13(filesToPack, offsets, sizesOnDisk)
			: buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
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
		header.writeUInt8(headerFlags ?? 0, 14);
		header.writeUInt8(headerPriority ?? 0, 15);
		header.fill(0, 16, 32);

		const trailerSize = 40;
		const trailer = Buffer.alloc(trailerSize);
		header.copy(trailer, 0, 0, 32);
		writeU32(trailer, 32, trailerSize);
		writeU32(trailer, 36, LSPK_SIGNATURE);

		output = Buffer.concat([dataBlock, numFilesBuf, compressedFileList, trailer]);
	}

	writeFileSync(outputPath, output);
}
