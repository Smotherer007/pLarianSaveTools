#!/usr/bin/env node
/**
 * Debug: LSF Roundtrip – vergleicht unkomprimierte Blöcke (String, Node, Attr, Values)
 * um zu prüfen, ob die String-Tabelle oder die LZ4-Kompression die Ursache ist.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LSFReader } from "../lsf/reader.js";
import { writeLsf } from "../lsf/writer.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lz4 = require("lz4");

const EXAMPLE = join(process.cwd(), "Example");
const UNPACKED_LSF = join(EXAMPLE, "QuickSave_13_unpacked_lsf");
const TMP = join(process.cwd(), "tmp-verify");

function decompressLz4Block(raw: Buffer, uncompressedSize: number): Buffer {
	if (raw.readUInt32LE(0) === 0x184d2204) {
		const dec = lz4.decode(raw);
		return Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
	}
	const out = Buffer.alloc(Math.max(uncompressedSize, raw.length * 10));
	const decoded = lz4.decodeBlock(raw, out);
	if (decoded < 0) {
		try {
			const dec = lz4.decode(raw);
			const buf = Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
			return buf.subarray(0, Math.min(buf.length, uncompressedSize * 2));
		} catch {
			throw new Error(`LZ4 decode failed: ${decoded}`);
		}
	}
	return out.subarray(0, decoded);
}

interface BlockMeta {
	uncompressedSize: number;
	compressedSize: number;
}

function extractBlocks(path: string): {
	strings: Buffer;
	nodes: Buffer;
	attrs: Buffer;
	values: Buffer;
	meta: { strings: BlockMeta; nodes: BlockMeta; attrs: BlockMeta; values: BlockMeta };
} {
	const buf = readFileSync(path);
	let o = 12; // LSOF + version + engineVersion
	const strings: BlockMeta = { uncompressedSize: buf.readUInt32LE(o), compressedSize: buf.readUInt32LE(o + 4) };
	const nodes: BlockMeta = { uncompressedSize: buf.readUInt32LE(o + 8), compressedSize: buf.readUInt32LE(o + 12) };
	const attrs: BlockMeta = { uncompressedSize: buf.readUInt32LE(o + 16), compressedSize: buf.readUInt32LE(o + 20) };
	const values: BlockMeta = { uncompressedSize: buf.readUInt32LE(o + 24), compressedSize: buf.readUInt32LE(o + 28) };
	o += 40;

	const stringRaw = buf.subarray(o, o + strings.compressedSize);
	o += strings.compressedSize;
	const nodeRaw = buf.subarray(o, o + nodes.compressedSize);
	o += nodes.compressedSize;
	const attrRaw = buf.subarray(o, o + attrs.compressedSize);
	o += attrs.compressedSize;
	const valueRaw = buf.subarray(o, o + values.compressedSize);

	return {
		strings: decompressLz4Block(stringRaw, strings.uncompressedSize),
		nodes: decompressLz4Block(nodeRaw, nodes.uncompressedSize),
		attrs: decompressLz4Block(attrRaw, attrs.uncompressedSize),
		values: decompressLz4Block(valueRaw, values.uncompressedSize),
		meta: { strings, nodes, attrs, values }
	};
}

function diffBuffers(a: Buffer, b: Buffer, name: string): void {
	if (a.equals(b)) {
		console.log(`  ${name}: IDENTISCH (${a.length} B)`);
		return;
	}
	console.log(`  ${name}: UNTERSCHIEDLICH (orig ${a.length} B, roundtrip ${b.length} B)`);
	const len = Math.min(a.length, b.length);
	let first = -1;
	let count = 0;
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) {
			if (first < 0) first = i;
			count++;
		}
	}
	if (first >= 0) {
		console.log(`    Erste Abweichung bei Offset ${first} (0x${first.toString(16)}), ${count} unterschiedliche Bytes`);
		// Hex-Dump um erste Abweichung
		const start = Math.max(0, first - 8);
		const end = Math.min(len, first + 24);
		console.log(`    orig:      ${a.subarray(start, end).toString("hex")}`);
		console.log(`    roundtrip: ${b.subarray(start, end).toString("hex")}`);
	}
	if (a.length !== b.length) {
		console.log(`    Längenunterschied: ${Math.abs(a.length - b.length)} B`);
	}
}

function main() {
	const rel = "meta.lsf";
	const origPath = join(UNPACKED_LSF, rel);

	// Roundtrip erzeugen (mit preserveStringTable für byte-identische String-Tabelle)
	const orig = readFileSync(origPath);
	const reader = new LSFReader(orig);
	const root = reader.read();
	const version = reader.getEngineVersion();
	const stringTable = reader.getStringTable();
	const lsxPath = join(TMP, "meta.lsx");
	mkdirSync(TMP, { recursive: true });
	writeFileSync(lsxPath, convertLsfToLsx(root, version), "utf8");
	const { root: root2, version: lsxVersion } = parseLsx(lsxPath);
	const roundtripPath = join(TMP, "roundtrip-meta.lsf");
	writeLsf(root2, roundtripPath, lsxVersion, {
		metadataFormat: 0,
		preserveStringTable: stringTable,
		attributeOrderPreOrder: UNPACKED_LSF.includes("QuickSave_13")
	});

	console.log("=== LSF meta.lsf: Unkomprimierte Blöcke vergleichen ===\n");

	const origBlocks = extractBlocks(origPath);
	const roundBlocks = extractBlocks(roundtripPath);

	diffBuffers(origBlocks.strings, roundBlocks.strings, "Strings");
	diffBuffers(origBlocks.nodes, roundBlocks.nodes, "Nodes");
	diffBuffers(origBlocks.attrs, roundBlocks.attrs, "Attributes");
	diffBuffers(origBlocks.values, roundBlocks.values, "Values");

	console.log("\n--- Meta-Größen ---");
	console.log("  orig:      strings uc=", origBlocks.meta.strings.uncompressedSize, "cc=", origBlocks.meta.strings.compressedSize);
	console.log("  roundtrip: strings uc=", roundBlocks.meta.strings.uncompressedSize, "cc=", roundBlocks.meta.strings.compressedSize);
}

main();
