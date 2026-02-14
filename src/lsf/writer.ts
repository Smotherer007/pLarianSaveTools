import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LSFNode, LSFAttribute, NodeAttributeType, TranslatedFSStringValue } from "./types.js";
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

/** C# String.GetHashCode – .NET Framework-Stil für LSLib-Kompatibilität */
function dotNetStringHashCode(s: string): number {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
	}
	return hash >>> 0;
}

/** LSLib Bucket: (hash & 0x1ff) ^ ((hash>>9) & 0x1ff) ^ ((hash>>18) & 0x1ff) ^ ((hash>>27) & 0x1ff) */
function hashToBucket(hashCode: number): number {
	return (
		(hashCode & 0x1ff) ^
		((hashCode >> 9) & 0x1ff) ^
		((hashCode >> 18) & 0x1ff) ^
		((hashCode >> 27) & 0x1ff)
	);
}

/** Strings in LSLib-Reihenfolge: WriteRegions → WriteNode → Name, Attrs, Children (depth-first) */
function collectStringsInOrder(node: LSFNode, out: string[]): void {
	out.push(node.name);
	for (const name of Object.keys(node.attributes)) out.push(name);
	for (const child of node.children) collectStringsInOrder(child, out);
}

/** LSLib String-Tabelle: 512 Buckets, (bucket<<16)|offset */
function buildStringTable(stringsInOrder: string[]): { buffer: Buffer; indexMap: Map<string, number> } {
	const STRING_HASH_MAP_SIZE = 0x200; // 512
	const buckets: string[][] = [];
	for (let i = 0; i < STRING_HASH_MAP_SIZE; i++) buckets.push([]);
	const indexMap = new Map<string, number>();

	for (const s of stringsInOrder) {
		if (indexMap.has(s)) continue;
		const hashCode = dotNetStringHashCode(s);
		const bucket = hashToBucket(hashCode);
		const chain = buckets[bucket];
		let found = -1;
		for (let i = 0; i < chain.length; i++) {
			if (chain[i] === s) {
				found = i;
				break;
			}
		}
		if (found >= 0) {
			indexMap.set(s, (bucket << 16) | found);
		} else {
			const offset = chain.length;
			chain.push(s);
			indexMap.set(s, (bucket << 16) | offset);
		}
	}

	let bufSize = 4;
	for (let i = 0; i < STRING_HASH_MAP_SIZE; i++) {
		bufSize += 2;
		for (const s of buckets[i]) {
			bufSize += 2 + Buffer.byteLength(s, "utf8");
		}
	}
	const buf = Buffer.alloc(bufSize);
	let off = 0;
	buf.writeUInt32LE(STRING_HASH_MAP_SIZE, off);
	off += 4;
	for (let i = 0; i < STRING_HASH_MAP_SIZE; i++) {
		const chain = buckets[i];
		buf.writeUInt16LE(chain.length, off);
		off += 2;
		for (const s of chain) {
			const enc = Buffer.from(s, "utf8");
			buf.writeUInt16LE(enc.length, off);
			off += 2;
			enc.copy(buf, off);
			off += enc.length;
		}
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

function serializeTranslatedFSString(attr: LSFAttribute, isBG3: boolean): Buffer {
	const ts = (attr.value as TranslatedFSStringValue) ?? {};
	const v = String(ts.value ?? "");
	const h = String(ts.handle ?? "");
	const args = ts.arguments ?? [];
	const chunks: Buffer[] = [];
	if (isBG3) {
		chunks.push(Buffer.from([0, 0])); // Version
	} else {
		const vEnc = Buffer.from(v + "\0", "utf8");
		const vBuf = Buffer.alloc(4 + vEnc.length);
		vBuf.writeInt32LE(vEnc.length, 0);
		vEnc.copy(vBuf, 4);
		chunks.push(vBuf);
	}
	const hEnc = Buffer.from(h + "\0", "utf8");
	const hBuf = Buffer.alloc(4 + hEnc.length);
	hBuf.writeInt32LE(hEnc.length, 0);
	hEnc.copy(hBuf, 4);
	chunks.push(hBuf);
	const argsBuf = Buffer.alloc(4);
	argsBuf.writeInt32LE(args.length, 0);
	chunks.push(argsBuf);
	for (const arg of args) {
		const kEnc = Buffer.from(arg.key + "\0", "utf8");
		const kBuf = Buffer.alloc(4 + kEnc.length);
		kBuf.writeInt32LE(kEnc.length, 0);
		kEnc.copy(kBuf, 4);
		chunks.push(kBuf);
		const sub = arg.string ?? { value: "", handle: "" };
		chunks.push(serializeTranslatedFSString({ ...attr, value: sub }, isBG3));
		const valEnc = Buffer.from(arg.value + "\0", "utf8");
		const valBuf = Buffer.alloc(4 + valEnc.length);
		valBuf.writeInt32LE(valEnc.length, 0);
		valEnc.copy(valBuf, 4);
		chunks.push(valBuf);
	}
	return Buffer.concat(chunks);
}

function serializeAttributeValue(attr: LSFAttribute, isBG3: boolean = false): Buffer {
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
		case NodeAttributeType.TranslatedString: {
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
		case NodeAttributeType.TranslatedFSString: {
			return serializeTranslatedFSString(attr, isBG3);
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

function getAttributeLength(attr: LSFAttribute, isBG3: boolean = false): number {
	return serializeAttributeValue(attr, isBG3).length;
}

function compressBlock(data: Buffer): Buffer {
	if (data.length === 0) return data;
	const maxOut = lz4.encodeBound(data.length);
	const out = Buffer.alloc(maxOut);
	// encodeBlockHC = bessere Kompression (LZ4_HC), gleiches Block-Format (decodeBlock-kompatibel)
	let written = -1;
	if (typeof lz4.encodeBlockHC === "function") {
		written = lz4.encodeBlockHC(data, out);
	}
	if (written <= 0) {
		written = lz4.encodeBlock(data, out);
	}
	return written > 0 ? out.subarray(0, written) : data;
}

export interface WriteLsfOptions {
	/** 0 = V2 (12 B/node, 12 B/attr, kompakter), 1 = V3 (16 B). DOS2 nutzt 0. */
	metadataFormat?: number;
}

export function writeLsf(root: LSFNode, outputPath: string, version?: LsfVersion, options?: WriteLsfOptions): void {
	const v = version ?? { major: 3, minor: 6, revision: 9, build: 0 };
	const isBG3 = v.major >= 4;
	const metadataFormat = options?.metadataFormat ?? (isBG3 ? 1 : 0);
	const engineVersion = packEngineVersion(v);

	const stringsInOrder: string[] = [];
	if (root.name === "save" && root.children.length > 0) {
		for (const region of root.children) collectStringsInOrder(region, stringsInOrder);
	} else {
		collectStringsInOrder(root, stringsInOrder);
	}
	const { buffer: stringBuf, indexMap } = buildStringTable(stringsInOrder);

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
			const len = getAttributeLength(attr, isBG3);
			valueChunks.push(serializeAttributeValue(attr, isBG3));
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

	const nodeEntrySize = metadataFormat === 1 ? 16 : 12;
	const attrEntrySize = metadataFormat === 1 ? 16 : 12;
	const nodeBuf = Buffer.alloc(flatNodes.length * nodeEntrySize);
	const attrBuf = Buffer.alloc(flatAttrs.length * attrEntrySize);

	if (metadataFormat === 1) {
		for (let i = 0; i < nodeEntries.length; i++) {
			const n = nodeEntries[i];
			const no = i * 16;
			nodeBuf.writeUInt32LE(n.nameIndex, no);
			nodeBuf.writeInt32LE(n.parentIndex, no + 4);
			nodeBuf.writeInt32LE(n.nextSiblingIndex, no + 8);
			nodeBuf.writeInt32LE(n.firstAttributeIndex, no + 12);
		}
		const nextAttrMap = new Map<number, number>();
		for (let i = 0; i < flatAttrs.length; i++) {
			const nodeAttrs = attrIdxByNode[flatAttrs[i].nodeIdx];
			const pos = nodeAttrs.indexOf(i);
			nextAttrMap.set(i, pos >= 0 && pos < nodeAttrs.length - 1 ? nodeAttrs[pos + 1] : -1);
		}
		valueOffset = 0;
		for (let i = 0; i < flatAttrs.length; i++) {
			const a = flatAttrs[i];
			const ao = i * 16;
			attrBuf.writeUInt32LE(a.nameIndex, ao);
			attrBuf.writeUInt32LE((a.type & 0x3f) | (a.length << 6), ao + 4);
			attrBuf.writeInt32LE(nextAttrMap.get(i) ?? -1, ao + 8);
			attrBuf.writeUInt32LE(valueOffset, ao + 12);
			valueOffset += a.length;
		}
	} else {
		for (let i = 0; i < nodeEntries.length; i++) {
			const n = nodeEntries[i];
			const no = i * 12;
			nodeBuf.writeUInt32LE(n.nameIndex, no);
			nodeBuf.writeInt32LE(n.firstAttributeIndex, no + 4);
			nodeBuf.writeInt32LE(n.parentIndex, no + 8);
		}
		valueOffset = 0;
		for (let i = 0; i < flatAttrs.length; i++) {
			const a = flatAttrs[i];
			const ao = i * 12;
			attrBuf.writeUInt32LE(a.nameIndex, ao);
			attrBuf.writeUInt32LE((a.type & 0x3f) | (a.length << 6), ao + 4);
			attrBuf.writeInt32LE(a.nodeIdx, ao + 8);
			valueOffset += a.length;
		}
	}

	const valuesBuf = Buffer.concat(valueChunks);

	const stringCompressed = compressBlock(stringBuf);
	const nodeCompressed = compressBlock(nodeBuf);
	const attrCompressed = compressBlock(attrBuf);
	const valueCompressed = compressBlock(valuesBuf);

	let output: Buffer;

	if (isBG3) {
		const meta = Buffer.alloc(48);
		meta.writeUInt32LE(stringBuf.length, 0);
		meta.writeUInt32LE(stringCompressed.length, 4);
		meta.writeUInt32LE(0, 8);
		meta.writeUInt32LE(0, 12);
		meta.writeUInt32LE(nodeBuf.length, 16);
		meta.writeUInt32LE(nodeCompressed.length, 20);
		meta.writeUInt32LE(attrBuf.length, 24);
		meta.writeUInt32LE(attrCompressed.length, 28);
		meta.writeUInt32LE(valuesBuf.length, 32);
		meta.writeUInt32LE(valueCompressed.length, 36);
		meta.writeUInt8(34, 40);
		meta.writeUInt32LE(1, 44);

		const header = Buffer.alloc(16);
		header.write("LSOF", 0);
		header.writeUInt32LE(6, 4);
		header.writeBigUInt64LE(packEngineVersionBG3(v), 8);

		output = Buffer.concat([header, meta, stringCompressed, nodeCompressed, attrCompressed, valueCompressed]);
	} else {
		const meta = Buffer.alloc(40);
		meta.writeUInt32LE(stringBuf.length, 0);
		meta.writeUInt32LE(stringCompressed.length, 4);
		meta.writeUInt32LE(nodeBuf.length, 8);
		meta.writeUInt32LE(nodeCompressed.length, 12);
		meta.writeUInt32LE(attrBuf.length, 16);
		meta.writeUInt32LE(attrCompressed.length, 20);
		meta.writeUInt32LE(valuesBuf.length, 24);
		meta.writeUInt32LE(valueCompressed.length, 28);
		meta.writeUInt32LE(34, 32);
		meta.writeUInt8(0, 36);
		meta.writeUInt16LE(0, 37);
		meta.writeUInt8(metadataFormat, 39);

		const header = Buffer.alloc(12);
		header.write("LSOF", 0);
		header.writeUInt32LE(3, 4);
		header.writeUInt32LE(engineVersion, 8);

		output = Buffer.concat([header, meta, stringCompressed, nodeCompressed, attrCompressed, valueCompressed]);
	}

	writeFileSync(outputPath, output);
}

/** LSF als Buffer schreiben (für In-Memory-Packing). */
export function writeLsfToBuffer(root: LSFNode, version?: LsfVersion, options?: WriteLsfOptions): Buffer {
	const tmp = join(tmpdir(), `lsf-${Date.now()}-${Math.random().toString(36).slice(2)}.lsf`);
	writeLsf(root, tmp, version, options);
	try {
		return readFileSync(tmp);
	} finally {
		unlinkSync(tmp);
	}
}
