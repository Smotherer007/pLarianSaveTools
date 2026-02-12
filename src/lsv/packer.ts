/**
 * LSV Packer – packt Dateien zurück in ein LSV-Paket
 * Verwendet Manifest von unpack (--manifest) für exakte Roundtrip-Kompatibilität
 * Unterstützt DOS2 (v13) und BG3 (v15/v16/v18)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { compress } from "./compression.js";
import { LSPK_SIGNATURE } from "./types.js";

const FILE_ENTRY_10_SIZE = 280;
const FILE_ENTRY_18_SIZE = 272;
const COMPRESSION_LZ4 = 2;

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

export interface PackManifest {
	version: number;
	files: Array<{
		name: string;
		flags: number;
		uncompressedSize: number;
		archivePart?: number;
	}>;
}

function loadManifest(dir: string): PackManifest {
	const path = join(dir, ".lsv.manifest.json");
	if (!existsSync(path)) {
		throw new Error(`Kein Manifest gefunden: ${path}. ` + `Entpacke zuerst mit --manifest: node dist/cli.js unpack datei.lsv output --manifest`);
	}
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw) as PackManifest;
}

function buildFileListDOS2(manifest: PackManifest, offsets: number[], sizesOnDisk: number[]): Buffer {
	const numFiles = manifest.files.length;
	const buf = Buffer.alloc(numFiles * FILE_ENTRY_10_SIZE);
	for (let i = 0; i < numFiles; i++) {
		const f = manifest.files[i];
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

function buildFileListBG3(manifest: PackManifest, offsets: number[], sizesOnDisk: number[], dataStartOffset: number): Buffer {
	const numFiles = manifest.files.length;
	const buf = Buffer.alloc(numFiles * FILE_ENTRY_18_SIZE);
	for (let i = 0; i < numFiles; i++) {
		const f = manifest.files[i];
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

/**
 * Packt ein Verzeichnis zurück in eine LSV-Datei.
 * Erfordert .lsv.manifest.json (von unpack --manifest).
 */
export function packLsv(inputDir: string, outputPath: string): void {
	const manifest = loadManifest(inputDir);
	const dataChunks: Buffer[] = [];
	const offsets: number[] = [];
	const sizesOnDisk: number[] = [];
	let offset = 0;

	for (const f of manifest.files) {
		const filePath = join(inputDir, f.name);
		if (!existsSync(filePath)) {
			throw new Error(`Datei nicht gefunden: ${filePath}`);
		}
		const raw = readFileSync(filePath);
		const compressed = f.flags === 0 || f.uncompressedSize === 0 ? raw : compress(raw, f.flags);
		offsets.push(offset);
		sizesOnDisk.push(compressed.length);
		offset += compressed.length;
		dataChunks.push(compressed);
	}

	const dataBlock = Buffer.concat(dataChunks);
	const isBG3 = manifest.version === 15 || manifest.version === 16 || manifest.version === 18;

	const bg3DataStart = 40;
	const fileList = isBG3 ? buildFileListBG3(manifest, offsets, sizesOnDisk, bg3DataStart) : buildFileListDOS2(manifest, offsets, sizesOnDisk);
	const compressedFileList = compress(fileList, COMPRESSION_LZ4);

	const fileListOffset = dataBlock.length;
	const fileListSize = isBG3 ? 4 + 4 + compressedFileList.length : 4 + compressedFileList.length;

	if (compressedFileList.length > fileList.length) {
		throw new Error(`File list compression fehlgesch: komprimiert ${compressedFileList.length} > unkomprimiert ${fileList.length}`);
	}

	let output: Buffer;

	if (isBG3) {
		// BG3: Header am Anfang (LSPKHeader16), dann Data, dann FileList
		const header = Buffer.alloc(40);
		writeU32(header, 0, LSPK_SIGNATURE);
		writeU32(header, 4, manifest.version);
		writeU64(header, 8, bg3DataStart + dataBlock.length);
		writeU32(header, 16, fileListSize);
		header.writeUInt8(0, 20);
		header.writeUInt8(0, 21);
		header.fill(0, 22, 38);
		header.writeUInt16LE(1, 38);

		const numFilesBuf = Buffer.alloc(4);
		writeU32(numFilesBuf, 0, manifest.files.length);
		const compressedSizeBuf = Buffer.alloc(4);
		writeU32(compressedSizeBuf, 0, compressedFileList.length);

		output = Buffer.concat([header, dataBlock, numFilesBuf, compressedSizeBuf, compressedFileList]);
	} else {
		// DOS2 v13: Trailer am Ende
		const header = Buffer.alloc(32);
		writeU32(header, 0, manifest.version || 13);
		writeU32(header, 4, fileListOffset);
		writeU32(header, 8, fileListSize);
		header.writeUInt16LE(1, 12);

		const numFilesBuf = Buffer.alloc(4);
		writeU32(numFilesBuf, 0, manifest.files.length);

		const trailerSize = 40;
		const trailer = Buffer.alloc(trailerSize);
		header.copy(trailer, 0, 0, 32);
		writeU32(trailer, 32, trailerSize);
		writeU32(trailer, 36, LSPK_SIGNATURE);

		output = Buffer.concat([dataBlock, numFilesBuf, compressedFileList, trailer]);
	}

	writeFileSync(outputPath, output);
}
