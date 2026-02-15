/**
 * LSV Packer – packs files back into an LSV package
 * LSLib-kompatibel: FileEntry15 für v13, Padding 0xAD, CRC32, Manifest-Reihenfolge
 * DOS2 (v13)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compress } from "./compression.js";
import { LSPK_SIGNATURE } from "./types.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { writeLsfToBuffer } from "../lsf/writer.js";
import { patchLsfValues } from "../lsf/patch.js";

const FILE_ENTRY_10_SIZE = 280;
const FILE_ENTRY_15_SIZE = 304; // LSLib: Name(256)+Offset(8)+SizeDisk(8)+Uncomp(8)+Part(4)+Flags(4)+Crc(4)+Unknown2(4)
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

/** CRC32 (IEEE) for LSLib v10–v16 compatibility */
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

/** LSLib: MD5 over uncompressed file contents (alphabetical), each hash byte +1 */
function computeArchiveHash(files: { name: string; raw: Buffer }[]): Buffer {
	const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "en"));
	const hash = createHash("md5");
	for (const f of sorted) {
		hash.update(f.raw);
	}
	const digest = hash.digest();
	const result = Buffer.alloc(16);
	for (let i = 0; i < 16; i++) {
		result[i] = (digest[i] + 1) & 0xff;
	}
	return result;
}

interface FileEntry {
	name: string;
	flags: number;
	uncompressedSize: number;
	archivePart?: number;
	crc?: number;
}

/** DOS2 LSV: Zlib for all files (like Divine/LSLib) */
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

/** Scan directory; uses __manifest__.json for order + flags (LSLib-compatible) */
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
				const isAuxiliary = (n: string) =>
					n.endsWith(".offsets.json") || n.endsWith(".base.lsf");
				const files = manifest.files
					.filter((f) => (typeof f === "string" ? f : f.name) !== MANIFEST_NAME)
					.filter((f) => !isAuxiliary(typeof f === "string" ? f : f.name))
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
					if (!rel.endsWith(".offsets.json") && !rel.endsWith(".base.lsf")) {
						fileNames.push(rel.replace(/\\/g, "/"));
					}
				}
			}
		}
	}
	walk("");
	return { files: fileNames.sort().map((name) => ({ name, flags: DEFAULT_LSV_FLAGS })) };
}

/** FileEntry15 (304 B) – LSLib v13 format with CRC32. Unpacker reads archivePart/Flags from entrySize-12/entrySize-8. */
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
		writeU32(buf, o + 280, f.crc ?? 0);
		writeU32(buf, o + 292, f.archivePart ?? 0);
		writeU32(buf, o + 296, f.flags & 0x0f);
	}
	return buf;
}

/** FileEntry10 (280 B) – DOS2 v13: Name(256)+Offset(4)+SizeDisk(4)+Uncomp(4)+Part(4)+Flags(4)+CRC(4) */
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
		writeU32(buf, o + 272, f.flags & 0x0f); // LSLib maskt auf CompressionMethod
		writeU32(buf, o + 276, f.crc ?? 0);
	}
	return buf;
}

export interface PackLsvOptions {
	/** LSV-Version: 13 (DOS2) */
	version?: number;
	/** Reference LSV: unchanged files use original bytes for byte-identical output */
	reference?: string;
}

/**
 * Pack a directory (LSF files) back into an LSV file.
 * Scans directory, Zlib for all (like Divine).
 */
export function packLsv(inputDir: string, outputPath: string, options?: PackLsvOptions): void {
	const version = options?.version ?? 13;

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

	const rawForHash: { name: string; raw: Buffer }[] = [];

	for (const f of filesToPack) {
		const filePath = join(inputDir, f.name);
		if (!existsSync(filePath)) {
			throw new Error(`Datei nicht gefunden: ${filePath}`);
		}
		const raw = readFileSync(filePath);
		rawForHash.push({ name: f.name, raw });
		const uncompressedSize = raw.length;
		const compressed = f.flags === 0 ? raw : compress(raw, f.flags);
		f.uncompressedSize = uncompressedSize;
		if (version >= 10 && version <= 16) f.crc = crc32(compressed);
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
		const padding = aligned - offset - compressed.length;
		dataChunks.push(compressed);
		if (padding > 0) {
			dataChunks.push(Buffer.alloc(padding, LSPK_PADDING_BYTE));
		}
		offset = aligned;
	}
	const dataBlock = Buffer.concat(dataChunks);

	const fileList = buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
	const compressedFileList = compress(fileList, COMPRESSION_LZ4);
	if (compressedFileList.length > fileList.length) {
		throw new Error(`File list compression fehlgesch: komprimiert ${compressedFileList.length} > unkomprimiert ${fileList.length}`);
	}
	const numFilesBuf = Buffer.alloc(4);
	writeU32(numFilesBuf, 0, filesToPack.length);
	const fileListRaw = Buffer.concat([numFilesBuf, compressedFileList]);

	const fileListOffset = dataBlock.length;
	const fileListSize = fileListRaw.length;

	// DOS2 v13: Trailer am Ende (LSPKHeader13: Version, FileListOffset, FileListSize, NumParts, Flags, Priority, Md5[16])
	const header = Buffer.alloc(32);
	writeU32(header, 0, version);
	writeU32(header, 4, fileListOffset);
	writeU32(header, 8, fileListSize);
	header.writeUInt16LE(1, 12); // NumParts
	header.writeUInt8(headerFlags ?? 0, 14); // Flags
	header.writeUInt8(headerPriority ?? 0, 15); // Priority
	computeArchiveHash(rawForHash).copy(header, 16, 0, 32);

	const trailerSize = 40;
	const trailer = Buffer.alloc(trailerSize);
	header.copy(trailer, 0, 0, 32);
	writeU32(trailer, 32, trailerSize);
	writeU32(trailer, 36, LSPK_SIGNATURE);

	const output = Buffer.concat([dataBlock, fileListRaw, trailer]);
	writeFileSync(outputPath, output);
}

/**
 * Pack a directory with LSX files (+ PNG etc.) back into an LSV file.
 * Converts LSX → LSF, other files unchanged. Scans directory (like Divine).
 */
export function packLsvFromLsx(inputDir: string, outputPath: string, options?: PackLsvOptions): void {
	const version = options?.version ?? 13;

	const { files: scanned, headerFlags, headerPriority } = scanDirectoryWithManifest(inputDir);
	const filesToPack: FileEntry[] = [];
	const rawForHash: { name: string; raw: Buffer }[] = [];
	const dataChunks: Buffer[] = [];
	const offsets: number[] = [];
	const sizesOnDisk: number[] = [];
	let offset = 0;

	for (const m of scanned) {
		const rel = m.name;
		const filePath = join(inputDir, rel);
		let raw: Buffer;
		let packageName: string;
		// LSX-Datei (extract-lsx) oder LSF mit zugehöriger LSX (convert-Workflow)
		const lsxPath = rel.toLowerCase().endsWith(".lsx") ? filePath : filePath.replace(/\.lsf$/i, ".lsx");
		const isLsxInput = rel.toLowerCase().endsWith(".lsx") || (rel.toLowerCase().endsWith(".lsf") && existsSync(lsxPath));
		if (isLsxInput) {
			const offsetsPath = lsxPath + ".offsets.json";
			const baseLsfPath = lsxPath + ".base.lsf";
			const origLsfPath = lsxPath.replace(/\.lsx$/i, ".lsf");
			// Prefer patched .lsf (patch writes there), else .base.lsf
			const basePath = existsSync(origLsfPath) ? origLsfPath : (existsSync(baseLsfPath) ? baseLsfPath : null);
			if (existsSync(offsetsPath) && basePath) {
				const baseLsf = readFileSync(basePath);
				const offsetMap = JSON.parse(readFileSync(offsetsPath, "utf8")) as {
					attributes: Record<string, { offset: number; length: number; type: number }>;
				};
				const { root } = parseLsx(lsxPath);
				raw = patchLsfValues(baseLsf, offsetMap, root);
			} else {
				const { root, version: lsxVersion } = parseLsx(lsxPath);
				const lsxOpts = lsxVersion.major >= 4 ? undefined : { metadataFormat: 0 };
				raw = writeLsfToBuffer(root, lsxVersion, lsxOpts);
			}
			packageName = rel.toLowerCase().endsWith(".lsx") ? rel.replace(/\.lsx$/i, ".lsf") : rel;
		} else {
			raw = readFileSync(filePath);
			packageName = rel;
		}
		rawForHash.push({ name: packageName, raw });
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
		const aligned = Math.ceil((offset + compressed.length) / LSPK_ALIGNMENT) * LSPK_ALIGNMENT;
		const padding = aligned - offset - compressed.length;
		dataChunks.push(compressed);
		if (padding > 0) {
			dataChunks.push(Buffer.alloc(padding, LSPK_PADDING_BYTE));
		}
		offset = aligned;
	}

	const dataBlock = Buffer.concat(dataChunks);

	const fileList = buildFileListDOS2(filesToPack, offsets, sizesOnDisk);
	const compressedFileList = compress(fileList, COMPRESSION_LZ4);

	const fileListOffset = dataBlock.length;
	const fileListSize = 4 + compressedFileList.length;

	if (compressedFileList.length > fileList.length) {
		throw new Error(`File list compression fehlgesch: komprimiert ${compressedFileList.length} > unkomprimiert ${fileList.length}`);
	}

	const numFilesBuf = Buffer.alloc(4);
	writeU32(numFilesBuf, 0, filesToPack.length);

	const header = Buffer.alloc(32);
	writeU32(header, 0, version);
	writeU32(header, 4, fileListOffset);
	writeU32(header, 8, fileListSize);
	header.writeUInt16LE(1, 12);
	header.writeUInt8(headerFlags ?? 0, 14);
	header.writeUInt8(headerPriority ?? 0, 15);
	computeArchiveHash(rawForHash).copy(header, 16, 0, 32);

	const trailerSize = 40;
	const trailer = Buffer.alloc(trailerSize);
	header.copy(trailer, 0, 0, 32);
	writeU32(trailer, 32, trailerSize);
	writeU32(trailer, 36, LSPK_SIGNATURE);

	const output = Buffer.concat([dataBlock, numFilesBuf, compressedFileList, trailer]);
	writeFileSync(outputPath, output);
}
