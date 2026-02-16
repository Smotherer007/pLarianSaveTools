/**
 * Compression/decompression for LSV package format
 * Supports Zlib, LZ4 (DOS2)
 */

import { inflateSync, deflateSync } from "node:zlib";
import { decompress as decompressZstd } from "fzstd";
import { uncompressSync, compressSync } from "lz4-napi";
import { getCompressionMethod } from "./types.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const zstdNapi = require("zstd-napi");

/** lz4-napi nutzt decompress_size_prepended – Größe voranstellen */
export function decompressLZ4(compressed: Buffer, decompressedSize: number): Buffer {
	const withSize = Buffer.allocUnsafe(4 + compressed.length);
	withSize.writeUInt32LE(decompressedSize, 0);
	compressed.copy(withSize, 4);
	return uncompressSync(withSize);
}

export function decompressZlib(compressed: Buffer): Buffer {
	return inflateSync(compressed);
}

export function decompressZstdBuffer(compressed: Buffer): Buffer {
	const out = decompressZstd(compressed);
	return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

export function decompress(compressed: Buffer, decompressedSize: number, flags: number): Buffer {
	const method = getCompressionMethod(flags);
	switch (method) {
		case 0: // None
			return compressed.subarray(0, decompressedSize);
		case 1: // Zlib
			return decompressZlib(compressed);
		case 2: // LZ4
			return decompressLZ4(compressed, decompressedSize);
		case 3: // Zstd
			return decompressZstdBuffer(compressed);
		default:
			throw new Error(`Unknown compression method: ${method}`);
	}
}

/** lz4-napi prependet Größe – LSV erwartet nur komprimierte Bytes */
export function compressLZ4(data: Buffer): Buffer {
	const out = compressSync(data);
	return out.length > 4 ? out.subarray(4) : data;
}

/** Zlib with default level (78 9c) – like DOS2/LSLib, not max (78 da) */
export function compressZlib(data: Buffer): Buffer {
	return deflateSync(data, { level: -1 });
}

export function compress(data: Buffer, flags: number): Buffer {
	const method = getCompressionMethod(flags);
	switch (method) {
		case 0:
			return data;
		case 1:
			return compressZlib(data);
		case 2:
			return compressLZ4(data);
		case 3: {
			const out = zstdNapi.compress(data);
			return Buffer.isBuffer(out) ? out : Buffer.from(out);
		}
		default:
			throw new Error(`Unknown compression method: ${method}`);
	}
}
