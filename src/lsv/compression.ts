/**
 * Compression/decompression for LSV package format
 * Supports Zlib, LZ4 (DOS2) und Zstd (BG3)
 */

import { inflateSync, deflateSync } from "node:zlib";
import { decompress as decompressZstd } from "fzstd";
import { getCompressionMethod } from "./types.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lz4 = require("lz4");
const zstdNapi = require("zstd-napi");

export function decompressLZ4(compressed: Buffer, decompressedSize: number): Buffer {
	const output = Buffer.alloc(Math.max(decompressedSize, compressed.length * 10));
	const result = lz4.decodeBlock(compressed, output);
	if (result < 0) {
		throw new Error(`LZ4 decompression failed: ${result}`);
	}
	return output.subarray(0, result);
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
		case 3: // Zstd (BG3)
			return decompressZstdBuffer(compressed);
		default:
			throw new Error(`Unknown compression method: ${method}`);
	}
}

export function compressLZ4(data: Buffer): Buffer {
	const maxOut = lz4.encodeBound(data.length);
	const out = Buffer.alloc(maxOut);
	const written = lz4.encodeBlock(data, out);
	if (written < 0) throw new Error(`LZ4 compression failed: ${written}`);
	return out.subarray(0, written);
}

export function compressZlib(data: Buffer): Buffer {
	return deflateSync(data);
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
