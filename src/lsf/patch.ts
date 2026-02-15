/**
 * In-Place-Patch: Werte aus LSX in die LSF injizieren ohne vollständige Re-Serialisierung.
 * Nutzt die Offset-Tabelle (.offsets.json) um nur den Values-Block zu ändern.
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

/** LZ4-Frame (chunked) für values – wie LSLib/DOS2 */
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

/** Prüft ob Wert semantisch gleich (z.B. Bool: 0xf7 und 0x01 beide true) – dann Original-Bytes behalten für Byte-Identität. */
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

/** Serialisiert einen Attribut-Wert zu Bytes (wie LSF-Writer). */
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
			// Komplexe Struktur – für Patch: Länge muss passen, sonst Fehler
			throw new Error("TranslatedFSString-Patch noch nicht implementiert");
		case NodeAttributeType.ScratchBuffer: {
			const decoded = Buffer.from(String(value ?? ""), "base64");
			return decoded;
		}
		default:
			return Buffer.from(String(value ?? ""), "utf8");
	}
}

/** Sammelt alle Attribute aus dem LSX-Baum mit Pfaden (Format wie getAttributeOffsetMap). */
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
 * Patched den Values-Block der LSF mit Werten aus dem LSX-Baum.
 * @param originalLsf - Original-LSF als Buffer
 * @param offsetMap - Offset-Tabelle (aus .offsets.json)
 * @param lsxRoot - Geparster LSX-Baum
 * @returns Gepatchter LSF-Buffer
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
