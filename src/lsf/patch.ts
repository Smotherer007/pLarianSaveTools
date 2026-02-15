/**
 * In-place patch: Inject values from LSX into LSF without full re-serialization.
 * Uses the offset table (.offsets.json) to modify only the values block.
 */

import { LSFNode, LSFAttribute, NodeAttributeType } from "./types.js";
import { decompressLZ4Frame } from "./reader.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lz4 = require("lz4");

export interface AttributeOffsetInfo {
	offset: number;
	length: number;
	type: number;
}

export interface OffsetMap {
	attributes: Record<string, AttributeOffsetInfo>;
}

function compressBlock(data: Buffer): Buffer {
	if (data.length === 0) return data;
	const maxOut = lz4.encodeBound(data.length);
	const out = Buffer.alloc(maxOut);
	let written = typeof lz4.encodeBlockHC === "function" ? lz4.encodeBlockHC(data, out) : -1;
	if (written <= 0) written = lz4.encodeBlock(data, out);
	return written > 0 ? out.subarray(0, written) : data;
}

/** LZ4-Frame (chunked) for values – like LSLib/DOS2 */
function compressChunked(data: Buffer): Buffer {
	if (data.length === 0) return data;
	const frame = lz4.encode(data, {
		blockIndependence: false,
		blockMaxSize: 64 << 10,
		blockChecksum: false,
		streamSize: false,
		streamChecksum: false,
		highCompression: true
	});
	return Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
}

/** Check if value is semantically equal (e.g. Bool: 0xf7 and 0x01 both true) – keep original bytes for byte-identity. */
function isSemanticallyEqual(type: number, value: unknown, orig: Buffer, serialized: Buffer): boolean {
	if (type === NodeAttributeType.Bool) {
		const origVal = orig.length >= 1 ? orig[0] !== 0 : false;
		const newVal = Boolean(value);
		return origVal === newVal;
	}
	if (type === NodeAttributeType.Byte || type === NodeAttributeType.Int8) {
		const origVal = orig.length >= 1 ? orig.readInt8(0) : 0;
		const newVal = Number(value) & 0xff;
		return origVal === newVal;
	}
	return false;
}

/** Deserialize bytes from the values block to a JavaScript value. */
function deserializeAttributeValue(buf: Buffer, type: number): unknown {
	if (buf.length === 0) return type === NodeAttributeType.String || type === NodeAttributeType.Path ? "" : 0;
	switch (type) {
		case NodeAttributeType.Byte:
		case NodeAttributeType.Int8:
			return buf.readInt8(0);
		case NodeAttributeType.Short:
			return buf.length >= 2 ? buf.readInt16LE(0) : 0;
		case NodeAttributeType.UShort:
			return buf.length >= 2 ? buf.readUInt16LE(0) : 0;
		case NodeAttributeType.Int:
			return buf.length >= 4 ? buf.readInt32LE(0) : 0;
		case NodeAttributeType.UInt:
			return buf.length >= 4 ? buf.readUInt32LE(0) : 0;
		case NodeAttributeType.Float:
			return buf.length >= 4 ? buf.readFloatLE(0) : 0;
		case NodeAttributeType.Double:
			return buf.length >= 8 ? buf.readDoubleLE(0) : 0;
		case NodeAttributeType.Bool:
			return buf.length >= 1 ? buf[0] !== 0 : false;
		case NodeAttributeType.String:
		case NodeAttributeType.Path:
		case NodeAttributeType.FixedString:
		case NodeAttributeType.LSString:
		case NodeAttributeType.WString:
		case NodeAttributeType.LSWString: {
			const content = buf.subarray(0, buf.length - 1);
			let last = content.length;
			while (last > 0 && content[last - 1] === 0) last--;
			return content.subarray(0, last).toString("utf8");
		}
		case NodeAttributeType.UUID: {
			if (buf.length !== 16) return buf.toString("hex");
			const b = Buffer.from(buf);
			for (let i = 8; i < 16; i += 2) [b[i], b[i + 1]] = [b[i + 1], b[i]];
			return [b.subarray(0, 4), b.subarray(4, 6), b.subarray(6, 8), b.subarray(8, 10), b.subarray(10, 16)].map((x) => x.toString("hex")).join("-");
		}
		case NodeAttributeType.TranslatedString: {
			if (buf.length < 8) return { value: "", handle: "" };
			let pos = 0;
			const valueLen = buf.readInt32LE(pos);
			pos += 4;
			let value = "";
			if (valueLen > 0 && buf.length >= pos + valueLen) {
				value = (deserializeAttributeValue(buf.subarray(pos, pos + valueLen), NodeAttributeType.String) as string) || "";
				pos += valueLen;
			}
			if (buf.length < pos + 4) return { value, handle: "" };
			const handleLen = buf.readInt32LE(pos);
			pos += 4;
			let handle = "";
			if (handleLen > 0 && buf.length >= pos + handleLen) {
				handle = (deserializeAttributeValue(buf.subarray(pos, pos + handleLen), NodeAttributeType.String) as string) || "";
			}
			return { value, handle };
		}
		case NodeAttributeType.ScratchBuffer:
			return buf.toString("base64");
		case NodeAttributeType.ULongLong:
			return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : "0";
		case NodeAttributeType.Long:
		case NodeAttributeType.Int64:
			return buf.length >= 8 ? buf.readBigInt64LE(0).toString() : "0";
		default:
			return buf.toString("utf8", 0, buf.indexOf(0) >= 0 ? buf.indexOf(0) : buf.length);
	}
}

/** Serialize an attribute value to bytes (like LSF writer). */
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
		case NodeAttributeType.Bool:
			return Buffer.from([value ? 1 : 0]);
		case NodeAttributeType.String:
		case NodeAttributeType.Path:
		case NodeAttributeType.FixedString:
		case NodeAttributeType.LSString:
		case NodeAttributeType.WString:
		case NodeAttributeType.LSWString: {
			const s = String(value ?? "");
			return Buffer.from(s + "\0", "utf8");
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
		case NodeAttributeType.TranslatedFSString:
			// Complex structure – for patch: length must match
			throw new Error("TranslatedFSString patch not yet implemented");
		case NodeAttributeType.ScratchBuffer: {
			const decoded = Buffer.from(String(value ?? ""), "base64");
			return decoded;
		}
		default:
			return Buffer.from(String(value ?? ""), "utf8");
	}
}

/** Collect all attributes from LSX tree with paths (format like getAttributeOffsetMap). */
function collectAttributesByPath(
	node: LSFNode,
	pathPrefix: string,
	result: Map<string, LSFAttribute>
): void {
	for (const [name, attr] of Object.entries(node.attributes)) {
		result.set(`${pathPrefix}/${name}`, attr);
	}
	const nameCounts = new Map<string, number>();
	for (const child of node.children) {
		const count = nameCounts.get(child.name) ?? 0;
		nameCounts.set(child.name, count + 1);
		const seg = count > 0 ? `${child.name}[${count}]` : child.name;
		collectAttributesByPath(child, `${pathPrefix}/${seg}`, result);
	}
}

function decompressBlock(
	buf: Buffer,
	meta: { uncompressedSize: number; compressedSize: number },
	method: number
): Buffer {
	const sizeOnDisk = meta.compressedSize;
	const uncompressedSize = meta.uncompressedSize;
	if (sizeOnDisk === 0 && uncompressedSize === 0) return Buffer.alloc(0);
	const toRead = sizeOnDisk > 0 ? sizeOnDisk : uncompressedSize;
	const raw = buf.subarray(0, toRead);
	if (method === 0) return raw;
	if (method === 2) {
		if (raw.readUInt32LE(0) === 0x184d2204) {
			try {
				const dec = lz4.decode(raw);
				return Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
			} catch {
				return decompressLZ4Frame(raw);
			}
		}
		const out = Buffer.alloc(Math.max(uncompressedSize, raw.length * 10));
		const decoded = lz4.decodeBlock(raw, out);
		if (decoded < 0) {
			try {
				const dec = lz4.decode(raw);
				return Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
			} catch {
				return decompressLZ4Frame(raw);
			}
		}
		return out.subarray(0, decoded);
	}
	return raw;
}

/**
 * Read a single value from LSF by path and offset map.
 * For frontend/API: read value without LSX parsing.
 *
 * @param lsf - LSF as Buffer
 * @param offsetMap - Offset table (from .offsets.json)
 * @param path - Attribute path (e.g. "MetaData/MetaData/Difficulty")
 * @returns The read value (String, Number, Boolean etc. depending on type)
 */
export function getLsfValue(lsf: Buffer, offsetMap: OffsetMap, path: string): unknown {
	const info = offsetMap.attributes[path];
	if (!info) {
		throw new Error(`Path not in offset map: ${path}`);
	}
	return getLsfValueAtOffset(lsf, info.offset, info.length, info.type);
}

/**
 * Read a single value at a raw offset.
 *
 * @param lsf - LSF as Buffer
 * @param offset - Offset in decompressed values block
 * @param length - Length in bytes
 * @param type - NodeAttributeType
 * @returns The read value
 */
export function getLsfValueAtOffset(lsf: Buffer, offset: number, length: number, type: number): unknown {
	const valuesBuf = extractValuesBlock(lsf);
	const buf = valuesBuf.subarray(offset, offset + length);
	return deserializeAttributeValue(buf, type);
}

/** Decompress the values block of the LSF. */
function extractValuesBlock(lsf: Buffer): Buffer {
	const headerSize = 12;
	const metaSize = 40;
	const o = headerSize;
	const stringsMeta = { uncompressedSize: lsf.readUInt32LE(o), compressedSize: lsf.readUInt32LE(o + 4) };
	const nodesMeta = { uncompressedSize: lsf.readUInt32LE(o + 8), compressedSize: lsf.readUInt32LE(o + 12) };
	const attrsMeta = { uncompressedSize: lsf.readUInt32LE(o + 16), compressedSize: lsf.readUInt32LE(o + 20) };
	const valuesMeta = { uncompressedSize: lsf.readUInt32LE(o + 24), compressedSize: lsf.readUInt32LE(o + 28) };
	const compressionFlags = lsf.readUInt32LE(o + 32);
	const method = compressionFlags & 0x0f;
	const blockSize = (m: { uncompressedSize: number; compressedSize: number }) => (m.compressedSize > 0 ? m.compressedSize : m.uncompressedSize);
	let pos = headerSize + metaSize;
	pos += blockSize(stringsMeta) + blockSize(nodesMeta) + blockSize(attrsMeta);
	const valuesRaw = lsf.subarray(pos, pos + blockSize(valuesMeta));
	return decompressBlock(valuesRaw, valuesMeta, method);
}

/**
 * Patch a single value in LSF by path and offset map.
 * For frontend/API: single change without LSX parsing.
 *
 * @param originalLsf - Original LSF as Buffer
 * @param offsetMap - Offset table (from .offsets.json)
 * @param path - Attribute path (e.g. "save/region/Difficulty")
 * @param value - New value (String, Number, Boolean etc. depending on type)
 * @returns Patched LSF buffer
 * @throws if path not in offsetMap or serialized value > original length
 */
export function patchLsfValue(
	originalLsf: Buffer,
	offsetMap: OffsetMap,
	path: string,
	value: unknown
): Buffer {
	const info = offsetMap.attributes[path];
	if (!info) {
		throw new Error(`Path not in offset map: ${path}`);
	}
	return patchLsfAtOffset(originalLsf, info.offset, info.length, info.type, value);
}

/**
 * Patch a single value at a raw offset.
 * For API: when offset/length/type already known (e.g. from own cache).
 *
 * @param originalLsf - Original LSF as Buffer
 * @param offset - Offset in decompressed values block
 * @param length - Max length (new serialized value must not be longer)
 * @param type - NodeAttributeType
 * @param value - New value
 * @returns Patched LSF buffer
 */
export function patchLsfAtOffset(
	originalLsf: Buffer,
	offset: number,
	length: number,
	type: number,
	value: unknown
): Buffer {
	const attr: LSFAttribute = { name: "", type, value };
	const newBytes = serializeAttributeValue(attr);
	if (newBytes.length > length) {
		throw new Error(`Value too long: ${newBytes.length} > ${length} (type ${type})`);
	}
	return patchLsfRaw(originalLsf, offset, length, newBytes);
}

/** Internal: Replace bytes in values block at offset with newBytes (null-pad if shorter). */
function patchLsfRaw(
	originalLsf: Buffer,
	valuesOffset: number,
	valuesLength: number,
	newBytes: Buffer
): Buffer {
	const headerSize = 12;
	const metaSize = 40;
	const o = headerSize;
	const stringsMeta = { uncompressedSize: originalLsf.readUInt32LE(o), compressedSize: originalLsf.readUInt32LE(o + 4) };
	const nodesMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 8), compressedSize: originalLsf.readUInt32LE(o + 12) };
	const attrsMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 16), compressedSize: originalLsf.readUInt32LE(o + 20) };
	const valuesMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 24), compressedSize: originalLsf.readUInt32LE(o + 28) };
	const compressionFlags = originalLsf.readUInt32LE(o + 32);
	const method = compressionFlags & 0x0f;

	const blockSize = (m: { uncompressedSize: number; compressedSize: number }) => (m.compressedSize > 0 ? m.compressedSize : m.uncompressedSize);
	let pos = headerSize + metaSize;
	const stringsRaw = originalLsf.subarray(pos, pos + blockSize(stringsMeta));
	pos += blockSize(stringsMeta);
	const nodesRaw = originalLsf.subarray(pos, pos + blockSize(nodesMeta));
	pos += blockSize(nodesMeta);
	const attrsRaw = originalLsf.subarray(pos, pos + blockSize(attrsMeta));
	pos += blockSize(attrsMeta);
	const valuesRaw = originalLsf.subarray(pos, pos + blockSize(valuesMeta));

	let valuesBuf = decompressBlock(valuesRaw, valuesMeta, method);
	newBytes.copy(valuesBuf, valuesOffset);
	if (newBytes.length < valuesLength) {
		valuesBuf.fill(0, valuesOffset + newBytes.length, valuesOffset + valuesLength);
	}

	const valuesCompressed = compressChunked(valuesBuf);
	const metaBlock = Buffer.from(originalLsf.subarray(headerSize, headerSize + metaSize));
	metaBlock.writeUInt32LE(valuesCompressed.length, 28);
	return Buffer.concat([
		originalLsf.subarray(0, headerSize),
		metaBlock,
		stringsRaw,
		nodesRaw,
		attrsRaw,
		valuesCompressed
	]);
}

/**
 * Patch the values block of LSF with values from the LSX tree.
 * @param originalLsf - Original LSF as Buffer
 * @param offsetMap - Offset table (from .offsets.json)
 * @param lsxRoot - Parsed LSX tree
 * @returns Patched LSF buffer
 */
export function patchLsfValues(originalLsf: Buffer, offsetMap: OffsetMap, lsxRoot: LSFNode): Buffer {
	const root = lsxRoot.name === "save" && lsxRoot.children.length === 1 ? lsxRoot.children[0] : lsxRoot;
	const lsxAttrs = new Map<string, LSFAttribute>();
	if (lsxRoot.name === "save" && lsxRoot.children.length > 1) {
		for (let i = 0; i < lsxRoot.children.length; i++) {
			collectAttributesByPath(lsxRoot.children[i], `save/region[${i}]`, lsxAttrs);
		}
	} else {
		collectAttributesByPath(root, root.name, lsxAttrs);
	}

	// LSF v3 Metadaten (DOS2)
	const headerSize = 12;
	const metaSize = 40;
	const o = headerSize;
	const stringsMeta = { uncompressedSize: originalLsf.readUInt32LE(o), compressedSize: originalLsf.readUInt32LE(o + 4) };
	const nodesMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 8), compressedSize: originalLsf.readUInt32LE(o + 12) };
	const attrsMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 16), compressedSize: originalLsf.readUInt32LE(o + 20) };
	const valuesMeta = { uncompressedSize: originalLsf.readUInt32LE(o + 24), compressedSize: originalLsf.readUInt32LE(o + 28) };
	const compressionFlags = originalLsf.readUInt32LE(o + 32);
	const method = compressionFlags & 0x0f;

	const blockSize = (m: { uncompressedSize: number; compressedSize: number }) => (m.compressedSize > 0 ? m.compressedSize : m.uncompressedSize);
	let pos = headerSize + metaSize;
	const stringsRaw = originalLsf.subarray(pos, pos + blockSize(stringsMeta));
	pos += blockSize(stringsMeta);
	const nodesRaw = originalLsf.subarray(pos, pos + blockSize(nodesMeta));
	pos += blockSize(nodesMeta);
	const attrsRaw = originalLsf.subarray(pos, pos + blockSize(attrsMeta));
	pos += blockSize(attrsMeta);
	const valuesRaw = originalLsf.subarray(pos, pos + blockSize(valuesMeta));

	let valuesBuf = decompressBlock(valuesRaw, valuesMeta, method);
	const valuesBufOrig = Buffer.from(valuesBuf);

	for (const [path, info] of Object.entries(offsetMap.attributes)) {
		const attr = lsxAttrs.get(path);
		if (!attr) continue;
		let newBytes: Buffer;
		try {
			newBytes = serializeAttributeValue(attr);
		} catch {
			continue;
		}
		if (newBytes.length > info.length) {
			continue;
		}
		const origBytes = valuesBuf.subarray(info.offset, info.offset + info.length);
		if (isSemanticallyEqual(attr.type, attr.value, origBytes, newBytes)) {
			continue;
		}
		newBytes.copy(valuesBuf, info.offset);
		if (newBytes.length < info.length) {
			valuesBuf.fill(0, info.offset + newBytes.length, info.offset + info.length);
		}
	}

	const valuesCompressed = valuesBuf.equals(valuesBufOrig) ? valuesRaw : compressChunked(valuesBuf);
	const metaBlock = Buffer.from(originalLsf.subarray(headerSize, headerSize + metaSize));
	metaBlock.writeUInt32LE(valuesCompressed.length, 28);
	return Buffer.concat([
		originalLsf.subarray(0, headerSize),
		metaBlock,
		stringsRaw,
		nodesRaw,
		attrsRaw,
		valuesCompressed
	]);
}
