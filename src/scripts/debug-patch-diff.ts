#!/usr/bin/env node
/**
 * Findet welche Attribute beim Patch abweichen (für Byte-Identität-Debug)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchLsfValues, type OffsetMap } from "../lsf/patch.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { LSFReader } from "../lsf/reader.js";
import { NodeAttributeType } from "../lsf/types.js";

const base = readFileSync("Example/QuickSave_14_converted/meta.lsx.base.lsf");
const offsetMap: OffsetMap = JSON.parse(
	readFileSync("Example/QuickSave_14_converted/meta.lsx.offsets.json", "utf8")
);
const { root } = parseLsx("Example/QuickSave_14_converted/meta.lsx");

const reader = new LSFReader(base);
reader.read();
const origOffsetMap = reader.getAttributeOffsetMap();

// Sammle LSX-Attribute
function collect(node: any, prefix: string, out: Map<string, any>) {
	for (const [name, attr] of Object.entries(node.attributes)) {
		out.set(`${prefix}/${name}`, attr);
	}
	const nameCounts = new Map<string, number>();
	for (const child of node.children) {
		const c = (nameCounts.get(child.name) ?? 0) + 1;
		nameCounts.set(child.name, c);
		const seg = c > 1 ? `${child.name}[${c - 1}]` : child.name;
		collect(child, `${prefix}/${seg}`, out);
	}
}
const lsxAttrs = new Map<string, any>();
collect(root, root.name, lsxAttrs);

// Serialisiere (vereinfacht)
function ser(attr: any): Buffer {
	const v = attr.value;
	const t = attr.type;
	if (t === NodeAttributeType.Int || t === NodeAttributeType.UInt) {
		const b = Buffer.alloc(4);
		if (t === NodeAttributeType.UInt) b.writeUInt32LE(Number(v) >>> 0, 0);
		else b.writeInt32LE(Number(v) | 0, 0);
		return b;
	}
	if (t === NodeAttributeType.Float) {
		const b = Buffer.alloc(4);
		b.writeFloatLE(Number(v), 0);
		return b;
	}
	if (t === NodeAttributeType.FixedString || t === NodeAttributeType.String) {
		return Buffer.from(String(v ?? "") + "\0", "utf8");
	}
	if (t === NodeAttributeType.Bool) return Buffer.from([v ? 1 : 0]);
	if (t === NodeAttributeType.Byte) return Buffer.from([Number(v) & 0xff]);
	return Buffer.alloc(0);
}

const values = reader.getValuesBuffer();
let diffCount = 0;
for (const [path, info] of origOffsetMap) {
	const attr = lsxAttrs.get(path);
	if (!attr) continue;
	const newB = ser(attr);
	if (newB.length !== info.length) {
		console.log(`LEN ${path}: orig=${info.length} new=${newB.length}`);
		diffCount++;
		continue;
	}
	const origB = values.subarray(info.offset, info.offset + info.length);
	if (!origB.equals(newB)) {
		console.log(`DIFF ${path} (type ${info.type}):`);
		console.log("  orig:", origB.toString("hex").slice(0, 80));
		console.log("  new:", newB.toString("hex").slice(0, 80));
		diffCount++;
	}
}
console.log(`\n${diffCount} Abweichungen gefunden`);
