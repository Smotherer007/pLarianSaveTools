import { writeFileSync } from "node:fs";
import { LSFNode, LSFAttribute, NodeAttributeType } from "./types.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lz4 = require("lz4");

export interface LsfVersion {
	major: number;
	minor: number;
	revision: number;
	build: number;
}

/** Engine-Version zu LSF-Header-Format (LSF v3): high byte = major*16+minor */
function packEngineVersion(v: LsfVersion): number {
	const high = ((v.major & 0xf) << 4) | (v.minor & 0xf);
	return (high << 24) | ((v.revision & 0xff) << 16) | ((v.build & 0xff) << 8);
}

/** Engine-Version zu BG3 Int64-Format (LSF v5+) */
function packEngineVersionBG3(v: LsfVersion): bigint {
	return (BigInt(v.major & 0x7f) << 55n) | (BigInt(v.minor & 0xff) << 47n) | (BigInt(v.revision & 0xffff) << 31n) | BigInt(v.build & 0x7fffffff);
}

function collectStrings(node: LSFNode): Set<string> {
	const names = new Set<string>();
	names.add(node.name);
	for (const attr of Object.values(node.attributes)) names.add(attr.name);
	for (const child of node.children) {
		for (const s of collectStrings(child)) names.add(s);
	}
	return names;
}

function buildStringTable(names: Set<string>): { buffer: Buffer; indexMap: Map<string, number> } {
	const unique = [...names];
	const indexMap = new Map<string, number>();
	let offset = 0;
	for (const s of unique) {
		indexMap.set(s, (0 << 16) | offset);
		offset++;
	}
	const buf = Buffer.alloc(4 + 2 + unique.length * (2 + 256));
	let off = 0;
	buf.writeUInt32LE(1, off);
	off += 4;
	buf.writeUInt16LE(unique.length, off);
	off += 2;
	for (const s of unique) {
		const enc = Buffer.from(s, "utf8");
		buf.writeUInt16LE(enc.length, off);
		off += 2;
		enc.copy(buf, off);
		off += enc.length;
	}
	return { buffer: buf.subarray(0, off), indexMap };
}

function flattenNodes(node: LSFNode, parentIdx: number, result: LSFNode[]): number {
	const idx = result.length;
	result.push(node);
	for (const child of node.children) {
		flattenNodes(child, idx, result);
	}
	return idx;
}

function serializeAttributeValue(attr: LSFAttribute): Buffer {
	const { type, value } = attr;
	switch (type) {
		case NodeAttributeType.Byte:
		case NodeAttributeType.Int8:
			return Buffer.from([Number(value) & 0xff]);
		case NodeAttributeType.Short: {
			const b = Buffer.alloc(2);
			const v = Number(value) & 0xffff;
			b.writeInt16LE(v > 32767 ? v - 65536 : v, 0);
			return b;
		}
		case NodeAttributeType.UShort: {
			const b = Buffer.alloc(2);
			b.writeUInt16LE(Number(value) & 0xffff, 0);
			return b;
		}
		case NodeAttributeType.Int: {
			const b = Buffer.alloc(4);
			b.writeInt32LE(Number(value) | 0, 0);
			return b;
		}
		case NodeAttributeType.UInt: {
			const b = Buffer.alloc(4);
			b.writeUInt32LE(Number(value) >>> 0, 0);
			return b;
		}
		case NodeAttributeType.Float: {
			const b = Buffer.alloc(4);
			b.writeFloatLE(Number(value), 0);
			return b;
		}
		case NodeAttributeType.Double: {
			const b = Buffer.alloc(8);
			b.writeDoubleLE(Number(value), 0);
			return b;
		}
		case NodeAttributeType.Bool: {
			return Buffer.from([value ? 1 : 0]);
		}
		case NodeAttributeType.String:
		case NodeAttributeType.Path:
		case NodeAttributeType.FixedString:
		case NodeAttributeType.LSString:
		case NodeAttributeType.WString:
		case NodeAttributeType.LSWString: {
			const s = String(value ?? "");
			const enc = Buffer.from(s + "\0", "utf8");
			return enc;
		}
		case NodeAttributeType.UUID: {
			const hex = String(value ?? "").replace(/-/g, "");
			const b = Buffer.alloc(16);
			for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
			for (let i = 8; i < 16; i += 2) [b[i], b[i + 1]] = [b[i + 1], b[i]];
			return b;
		}
		case NodeAttributeType.TranslatedString:
		case NodeAttributeType.TranslatedFSString: {
			const ts = (value as { value?: string; handle?: string }) ?? {};
			const v = String(ts.value ?? "");
			const h = String(ts.handle ?? "");
			const vEnc = Buffer.from(v + "\0", "utf8");
			const hEnc = Buffer.from(h + "\0", "utf8");
			const out = Buffer.alloc(4 + vEnc.length + 4 + hEnc.length);
			let o = 0;
			out.writeInt32LE(vEnc.length, o);
			o += 4;
			vEnc.copy(out, o);
			o += vEnc.length;
			out.writeInt32LE(hEnc.length, o);
			o += 4;
			hEnc.copy(out, o);
			return out;
		}
		case NodeAttributeType.IVec2:
		case NodeAttributeType.IVec3:
		case NodeAttributeType.IVec4:
		case NodeAttributeType.Vec2:
		case NodeAttributeType.Vec3:
		case NodeAttributeType.Vec4: {
			const parts = String(value).trim().split(/\s+/).map(Number);
			const isInt = type >= NodeAttributeType.IVec2 && type <= NodeAttributeType.IVec4;
			const comps = type === NodeAttributeType.IVec2 || type === NodeAttributeType.Vec2 ? 2 : type === NodeAttributeType.IVec3 || type === NodeAttributeType.Vec3 ? 3 : 4;
			const elemSize = isInt ? 4 : 4;
			const b = Buffer.alloc(comps * elemSize);
			for (let i = 0; i < comps; i++) {
				if (isInt) b.writeInt32LE(parts[i] || 0, i * 4);
				else b.writeFloatLE(parts[i] || 0, i * 4);
			}
			return b;
		}
		case NodeAttributeType.ULongLong:
		case NodeAttributeType.Long:
		case NodeAttributeType.Int64: {
			const b = Buffer.alloc(8);
			try {
				b.writeBigInt64LE(BigInt(value ?? 0), 0);
			} catch {
				b.writeBigInt64LE(0n, 0);
			}
			return b;
		}
		case NodeAttributeType.ScratchBuffer: {
			return Buffer.from(String(value ?? ""), "base64");
		}
		default:
			return Buffer.from(String(value ?? ""), "utf8");
	}
}

function getAttributeLength(attr: LSFAttribute): number {
	return serializeAttributeValue(attr).length;
}

function compressBlock(data: Buffer): Buffer {
	if (data.length === 0) return data;
	const maxOut = lz4.encodeBound(data.length);
	const out = Buffer.alloc(maxOut);
	const written = lz4.encodeBlock(data, out);
	if (written >= 0) return out.subarray(0, written);
	return data;
}

export function writeLsf(root: LSFNode, outputPath: string, version?: LsfVersion): void {
	const v = version ?? { major: 3, minor: 6, revision: 9, build: 0 };
	const engineVersion = packEngineVersion(v);

	const names = collectStrings(root);
	const { buffer: stringBuf, indexMap } = buildStringTable(names);

	const flatNodes: LSFNode[] = [];
	if (root.name === "save" && root.children.length > 0) {
		for (const region of root.children) {
			flattenNodes(region, -1, flatNodes);
		}
	} else {
		flattenNodes(root, -1, flatNodes);
	}

	const nodeEntries: { nameIndex: number; parentIndex: number; nextSiblingIndex: number; firstAttributeIndex: number }[] = [];
	const flatAttrs: { nameIndex: number; type: NodeAttributeType; length: number; nodeIdx: number }[] = [];
	const valueChunks: Buffer[] = [];
	let valueOffset = 0;
	const attrIdxByNode: number[][] = [];

	for (let i = 0; i < flatNodes.length; i++) {
		attrIdxByNode.push([]);
	}

	let attrIdx = 0;
	for (let nodeIdx = 0; nodeIdx < flatNodes.length; nodeIdx++) {
		const node = flatNodes[nodeIdx];
		const attrNames = Object.keys(node.attributes);
		const firstAttrIdx = attrNames.length > 0 ? attrIdx : -1;

		for (const name of attrNames) {
			const attr = node.attributes[name];
			const len = getAttributeLength(attr);
			valueChunks.push(serializeAttributeValue(attr));
			flatAttrs.push({
				nameIndex: indexMap.get(name) ?? 0,
				type: attr.type,
				length: len,
				nodeIdx
			});
			attrIdxByNode[nodeIdx].push(attrIdx);
			attrIdx++;
		}

		let parentIdx = -1;
		for (let p = 0; p < nodeIdx; p++) {
			if (flatNodes[p].children.includes(node)) {
				parentIdx = p;
				break;
			}
		}
		let nextSiblingIdx = -1;
		if (parentIdx >= 0) {
			const siblings = flatNodes[parentIdx].children;
			const pos = siblings.indexOf(node);
			if (pos >= 0 && pos < siblings.length - 1) {
				const nextNode = siblings[pos + 1];
				nextSiblingIdx = flatNodes.indexOf(nextNode);
				if (nextSiblingIdx < 0) nextSiblingIdx = -1;
			}
		}

		nodeEntries.push({
			nameIndex: indexMap.get(node.name) ?? 0,
			parentIndex: parentIdx,
			nextSiblingIndex: nextSiblingIdx,
			firstAttributeIndex: firstAttrIdx
		});
	}

	const nodeBuf = Buffer.alloc(flatNodes.length * 16);
	for (let i = 0; i < nodeEntries.length; i++) {
		const n = nodeEntries[i];
		const no = i * 16;
		nodeBuf.writeUInt32LE(n.nameIndex, no);
		nodeBuf.writeInt32LE(n.parentIndex, no + 4);
		nodeBuf.writeInt32LE(n.nextSiblingIndex, no + 8);
		nodeBuf.writeInt32LE(n.firstAttributeIndex, no + 12);
	}

	// nextAttributeIndex pro Node: letzter Attr = -1, sonst Index des nächsten
	const nextAttrMap = new Map<number, number>();
	for (let i = 0; i < flatAttrs.length; i++) {
		const nodeAttrs = attrIdxByNode[flatAttrs[i].nodeIdx];
		const pos = nodeAttrs.indexOf(i);
		nextAttrMap.set(i, pos >= 0 && pos < nodeAttrs.length - 1 ? nodeAttrs[pos + 1] : -1);
	}

	const attrBuf = Buffer.alloc(flatAttrs.length * 16);
	for (let i = 0; i < flatAttrs.length; i++) {
		const a = flatAttrs[i];
		const ao = i * 16;
		attrBuf.writeUInt32LE(a.nameIndex, ao);
		attrBuf.writeUInt32LE((a.type & 0x3f) | (a.length << 6), ao + 4);
		attrBuf.writeInt32LE(nextAttrMap.get(i) ?? -1, ao + 8);
		attrBuf.writeUInt32LE(valueOffset, ao + 12);
		valueOffset += a.length;
	}

	const valuesBuf = Buffer.concat(valueChunks);

	const stringCompressed = compressBlock(stringBuf);
	const nodeCompressed = compressBlock(nodeBuf);
	const attrCompressed = compressBlock(attrBuf);
	const valueCompressed = compressBlock(valuesBuf);

	const isBG3 = v.major >= 4;
	let output: Buffer;

	if (isBG3) {
		// BG3 v6+: 16-Byte-Header, 48-Byte-Meta, Block-Reihenfolge strings, nodes, keys, attrs, values
		const meta = Buffer.alloc(48);
		meta.writeUInt32LE(stringBuf.length, 0);
		meta.writeUInt32LE(stringCompressed.length, 4);
		meta.writeUInt32LE(0, 8); // keys uncompressed
		meta.writeUInt32LE(0, 12); // keys compressed
		meta.writeUInt32LE(nodeBuf.length, 16);
		meta.writeUInt32LE(nodeCompressed.length, 20);
		meta.writeUInt32LE(attrBuf.length, 24);
		meta.writeUInt32LE(attrCompressed.length, 28);
		meta.writeUInt32LE(valuesBuf.length, 32);
		meta.writeUInt32LE(valueCompressed.length, 36);
		meta.writeUInt8(34, 40); // LZ4 (0x22)
		meta.writeUInt32LE(1, 44); // metadataFormat 1 (V3)

		const header = Buffer.alloc(16);
		header.write("LSOF", 0);
		header.writeUInt32LE(6, 4); // LSF v6
		header.writeBigUInt64LE(packEngineVersionBG3(v), 8);

		output = Buffer.concat([header, meta, stringCompressed, nodeCompressed, attrCompressed, valueCompressed]);
	} else {
		// DOS2 v3
		const meta = Buffer.alloc(40);
		meta.writeUInt32LE(stringBuf.length, 0);
		meta.writeUInt32LE(stringCompressed.length, 4);
		meta.writeUInt32LE(nodeBuf.length, 8);
		meta.writeUInt32LE(nodeCompressed.length, 12);
		meta.writeUInt32LE(attrBuf.length, 16);
		meta.writeUInt32LE(attrCompressed.length, 20);
		meta.writeUInt32LE(valuesBuf.length, 24);
		meta.writeUInt32LE(valueCompressed.length, 28);
		meta.writeUInt32LE(34, 32); // LZ4 (0x22)
		meta.writeUInt8(0, 36);
		meta.writeUInt16LE(0, 37);
		meta.writeUInt8(1, 39);

		const header = Buffer.alloc(12);
		header.write("LSOF", 0);
		header.writeUInt32LE(3, 4);
		header.writeUInt32LE(engineVersion, 8);

		output = Buffer.concat([header, meta, stringCompressed, nodeCompressed, attrCompressed, valueCompressed]);
	}

	writeFileSync(outputPath, output);
}
