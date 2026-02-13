import { readFileSync } from "node:fs";
import { LSFAttribute, LSFAttributeEntry, LSFHeader, LSFMetadataBlock, LSFNode, LSFNodeEntry, NodeAttributeType, TranslatedFSStringValue } from "./types.js";
import { decompress as decompressZstd } from "fzstd";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lz4 = require("lz4");

/** LZ4 Frame manuell dekodieren – unterstützt abhängige Blöcke (blockIndependence=0) für LSF */
function decompressLZ4Frame(raw: Buffer): Buffer {
	const LZ4_MAGIC = 0x184d2204;
	const blockMaxSizes = [0, 0, 0, 0, 64 << 10, 256 << 10, 1 << 20, 4 << 20];
	const EOS = 0;
	let pos = 0;
	if (raw.readUInt32LE(pos) !== LZ4_MAGIC) {
		throw new Error("Invalid LZ4 frame magic");
	}
	pos += 4;
	const flg = raw[pos++];
	const bd = raw[pos++];
	const version = flg >> 6;
	if (version !== 1) throw new Error(`LZ4 frame version ${version} not supported`);
	const blockIndependence = ((flg >> 5) & 1) !== 0;
	const blockMaxSizeIndex = (bd >> 4) & 0x7;
	const blockMaxSize = blockMaxSizes[blockMaxSizeIndex] || 4 << 20;
	const blockChecksum = (flg >> 4) & 1;
	const streamSize = (flg >> 3) & 1;
	const dict = flg & 1;
	if (streamSize) pos += 8;
	if (dict) pos += 4;
	pos += 1; // descriptor checksum
	const chunks: Buffer[] = [];
	const maxBlockBuffer = Math.max(blockMaxSize, 4 << 20);
	let dictBuf: Buffer = Buffer.alloc(0);
	const DICT_SIZE = 64 << 10;
	const bindings = (lz4 as { utils?: { bindings?: { uncompressWithDict?: (input: Buffer, output: Buffer, dict?: Buffer) => number } } }).utils?.bindings;
	const uncompressWithDict = bindings?.uncompressWithDict;

	const decompressBlock = (blockData: Buffer, out: Buffer): number => {
		if (!blockIndependence && dictBuf.length > 0 && uncompressWithDict) {
			return uncompressWithDict(blockData, out, dictBuf);
		}
		return lz4.decodeBlock(blockData, out);
	};

	while (pos < raw.length - 4) {
		const blockSize = raw.readUInt32LE(pos);
		pos += 4;
		if (blockSize === EOS) break;
		const isUncompressed = (blockSize & 0x80000000) !== 0;
		const size = blockSize & 0x7fffffff;
		if (pos + size > raw.length) break;
		const blockData = raw.subarray(pos, pos + size);
		pos += size;
		if (blockChecksum) pos += 4;
		if (isUncompressed) {
			chunks.push(blockData);
			dictBuf = Buffer.concat([dictBuf, blockData]).subarray(-DICT_SIZE);
		} else {
			const out = Buffer.alloc(maxBlockBuffer);
			const decoded = decompressBlock(blockData, out);
			if (decoded < 0) {
				throw new Error(`LZ4 block decompression failed at offset ${pos - size - (blockChecksum ? 4 : 0)}, code ${decoded}`);
			}
			const chunk = out.subarray(0, decoded);
			chunks.push(chunk);
			dictBuf = Buffer.concat([dictBuf, chunk]).subarray(-DICT_SIZE);
		}
	}
	return Buffer.concat(chunks);
}

export class LSFReader {
	private buffer: Buffer;
	private offset: number = 0;
	private header!: LSFHeader;
	private meta!: LSFMetadataBlock;

	private strings: string[][] = [];
	private nodes: LSFNodeEntry[] = [];
	private attributes: LSFAttributeEntry[] = [];
	private values!: Buffer;

	constructor(pathOrBuffer: string | Buffer) {
		this.buffer = Buffer.isBuffer(pathOrBuffer) ? pathOrBuffer : readFileSync(pathOrBuffer);
	}

	public read(): LSFNode {
		this.readHeader();
		this.readMetadata();
		this.readBlocks();
		return this.reconstructTree();
	}

	/** Engine-Version aus dem LSF-Header. */
	public getEngineVersion(): { major: number; minor: number; revision: number; build: number } {
		const v = this.header.engineVersion;
		if (this.header.version >= 5) {
			return {
				major: Number((v >> 55n) & 0x7fn),
				minor: Number((v >> 47n) & 0xffn),
				revision: Number((v >> 31n) & 0xffffn),
				build: Number(v & 0x7fffffffn)
			};
		}
		const v32 = Number(v) >>> 0;
		const high = (v32 >> 24) & 0xff;
		return {
			major: high >> 4,
			minor: high & 0xf,
			revision: (v32 >> 16) & 0xff,
			build: (v32 >> 8) & 0xff
		};
	}

	private readHeader() {
		const magic = this.buffer.toString("utf8", 0, 4);
		if (magic !== "LSOF") {
			throw new Error(`Invalid LSF magic: ${magic}`);
		}
		const version = this.buffer.readUInt32LE(4);
		// BG3 v5+ (VerBG3ExtendedHeader): Int64 EngineVersion
		const engineVersion = version >= 5 ? this.buffer.readBigUInt64LE(8) : BigInt(this.buffer.readUInt32LE(8) >>> 0);
		this.header = { magic, version, engineVersion };
		this.offset = version >= 5 ? 16 : 12; // 8+8 vs 8+4
	}

	private readMetadata() {
		const o = this.offset;
		// BG3 v6+ (VerBG3NodeKeys): LSFMetadataV6 mit Keys-Block
		if (this.header.version >= 6) {
			this.meta = {
				strings: {
					uncompressedSize: this.buffer.readUInt32LE(o),
					compressedSize: this.buffer.readUInt32LE(o + 4)
				},
				keys: {
					uncompressedSize: this.buffer.readUInt32LE(o + 8),
					compressedSize: this.buffer.readUInt32LE(o + 12)
				},
				nodes: {
					uncompressedSize: this.buffer.readUInt32LE(o + 16),
					compressedSize: this.buffer.readUInt32LE(o + 20)
				},
				attributes: {
					uncompressedSize: this.buffer.readUInt32LE(o + 24),
					compressedSize: this.buffer.readUInt32LE(o + 28)
				},
				values: {
					uncompressedSize: this.buffer.readUInt32LE(o + 32),
					compressedSize: this.buffer.readUInt32LE(o + 36)
				},
				compressionFlags: this.buffer.readUInt8(o + 40) ?? 0,
				metadataFormat: this.buffer.readUInt32LE(o + 44) ?? 0
			};
			this.offset = o + 48; // 10*4 + 1 + 1 + 2 + 4
		} else {
			// DOS2 v3: LSFMetadataV5
			this.meta = {
				strings: {
					uncompressedSize: this.buffer.readUInt32LE(o),
					compressedSize: this.buffer.readUInt32LE(o + 4)
				},
				nodes: {
					uncompressedSize: this.buffer.readUInt32LE(o + 8),
					compressedSize: this.buffer.readUInt32LE(o + 12)
				},
				attributes: {
					uncompressedSize: this.buffer.readUInt32LE(o + 16),
					compressedSize: this.buffer.readUInt32LE(o + 20)
				},
				values: {
					uncompressedSize: this.buffer.readUInt32LE(o + 24),
					compressedSize: this.buffer.readUInt32LE(o + 28)
				},
				compressionFlags: this.buffer.readUInt32LE(o + 32),
				metadataFormat: this.buffer.readUInt8(o + 39) ?? 0
			};
			this.offset = o + 40;
		}
	}

	private readBlocks() {
		const { strings, nodes, attributes, values } = this.meta;

		const stringBuf = this.decompressBlock(strings, false); // allowChunked=false für Strings
		this.parseStringTable(stringBuf);

		// BG3 v6+: Block-Reihenfolge auf Disk ist strings, nodes, keys, attrs, values
		// Keys+Attrs können als ein LZ4-Frame zusammengefasst sein
		if (this.header.version >= 6) {
			const nodeBuf = this.decompressBlock(nodes, true);
			this.parseNodes(nodeBuf);

			if (this.meta.keys && (this.meta.keys.compressedSize > 0 || this.meta.keys.uncompressedSize > 0)) {
				// Keys+Attrs als kombinierter Block versuchen (LZ4-Frame umspannt beide)
				const combinedSize = this.meta.keys.compressedSize + attributes.compressedSize;
				const combinedBuf = this.decompressBlock({ uncompressedSize: attributes.uncompressedSize, compressedSize: combinedSize }, true);
				// Keys-Daten verwerfen, nur Attrs verwenden
				this.parseAttributes(combinedBuf);
			} else {
				const attrBuf = this.decompressBlock(attributes, true);
				this.parseAttributes(attrBuf);
			}
		} else {
			// DOS2 v3/v5: strings, keys (falls v6), nodes, attrs, values
			if (this.meta.keys && (this.meta.keys.compressedSize > 0 || this.meta.keys.uncompressedSize > 0)) {
				this.decompressBlock(this.meta.keys, true);
			}
			const nodeBuf = this.decompressBlock(nodes, true);
			this.parseNodes(nodeBuf);
			const attrBuf = this.decompressBlock(attributes, true);
			this.parseAttributes(attrBuf);
		}

		this.values = this.decompressBlock(values, true, true); // isValues=true für Fallback
	}

	private decompressBlock(meta: { uncompressedSize: number; compressedSize: number }, allowChunked: boolean, isValues: boolean = false): Buffer {
		const method = (this.meta.compressionFlags & 0x0f) as number;
		const sizeOnDisk = meta.compressedSize;
		const uncompressedSize = meta.uncompressedSize;

		if (sizeOnDisk === 0 && uncompressedSize === 0) {
			return Buffer.alloc(0);
		}
		if (sizeOnDisk === 0 && uncompressedSize > 0) {
			const raw = this.buffer.subarray(this.offset, this.offset + uncompressedSize);
			this.offset += uncompressedSize;
			return raw;
		}

		const toRead = method !== 0 ? sizeOnDisk : uncompressedSize;
		const raw = this.buffer.subarray(this.offset, this.offset + toRead);
		const startOff = this.offset;
		this.offset += toRead;

		if (method === 0) {
			return raw;
		}

		if (method === 3) {
			const dec = decompressZstd(raw);
			return Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
		}

		if (method === 2) {
			if (raw.readUInt32LE(0) === 0x184d2204) {
				// LZ4-Frame: lz4.decode() nutzen (eigene decompressLZ4Frame schlägt bei abhängigen Blöcken fehl)
				try {
					const dec = lz4.decode(raw);
					return Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
				} catch {
					return decompressLZ4Frame(raw);
				}
			}
			// Größerer Puffer wie bei LSV – manche Blöcke brauchen mehr Platz
			const out = Buffer.alloc(Math.max(uncompressedSize, raw.length * 10));
			let decoded = lz4.decodeBlock(raw, out);
			if (decoded < 0) {
				// Fallback: LZ4-Frame ohne Magic am Anfang oder Zstd (BG3/DOS2-Varianten)
				try {
					const dec = lz4.decode(raw);
					const buf = Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
					if (buf.length <= uncompressedSize * 2) return buf.subarray(0, buf.length);
				} catch {
					// ignore
				}
				try {
					const dec = decompressZstd(raw);
					const buf = Buffer.isBuffer(dec) ? dec : Buffer.from(dec);
					if (buf.length <= uncompressedSize * 2) return buf.subarray(0, Math.min(buf.length, uncompressedSize));
				} catch {
					// ignore
				}
				// BG3 LevelCache: Values-Block kann anderes Format haben – Rohdaten mit Null-Padding als Fallback
				if (isValues && sizeOnDisk <= uncompressedSize) {
					const result = Buffer.alloc(uncompressedSize, 0);
					raw.copy(result, 0, 0, Math.min(sizeOnDisk, uncompressedSize));
					return result;
				}
				// Debug: welche Blockgrößen
				throw new Error(`LZ4 block decompression failed at offset ${startOff}, code ${decoded} (uc=${uncompressedSize}, c=${sizeOnDisk})`);
			}
			return out.subarray(0, decoded);
		}

		if (method === 1) {
			const { inflateSync } = require("node:zlib");
			return inflateSync(raw);
		}

		throw new Error(`Unsupported LSF compression method: ${method}`);
	}

	private parseStringTable(buffer: Buffer) {
		let off = 0;
		const numHashEntries = buffer.readUInt32LE(off);
		off += 4;

		for (let i = 0; i < numHashEntries; i++) {
			const chainLength = buffer.readUInt16LE(off);
			off += 2;
			const bucket: string[] = [];
			for (let j = 0; j < chainLength; j++) {
				const strLen = buffer.readUInt16LE(off);
				off += 2;
				const str = buffer.toString("utf8", off, off + strLen);
				bucket.push(str);
				off += strLen;
			}
			this.strings.push(bucket);
		}
	}

	private resolveName(nameHashTableIndex: number): string {
		const bucket = nameHashTableIndex >> 16;
		const offset = nameHashTableIndex & 0xffff;
		if (this.strings[bucket]?.[offset] !== undefined) {
			return this.strings[bucket][offset];
		}
		return `undefined_0x${nameHashTableIndex.toString(16)}`;
	}

	private parseNodes(buffer: Buffer) {
		// V2 (12 B): NameHashTableIndex, FirstAttributeIndex, ParentIndex
		// V3 (16 B): KeysAndAdjacency, + NextSiblingIndex
		const entrySize = this.meta.metadataFormat === 1 ? 16 : 12;

		let off = 0;
		while (off < buffer.length) {
			if (entrySize === 16) {
				this.nodes.push({
					nameIndex: buffer.readUInt32LE(off),
					parentIndex: buffer.readInt32LE(off + 4),
					nextSiblingIndex: buffer.readInt32LE(off + 8),
					firstAttributeIndex: buffer.readInt32LE(off + 12)
				});
			} else {
				this.nodes.push({
					nameIndex: buffer.readUInt32LE(off),
					parentIndex: buffer.readInt32LE(off + 8),
					nextSiblingIndex: -1,
					firstAttributeIndex: buffer.readInt32LE(off + 4)
				});
			}
			off += entrySize;
		}
	}

	private parseAttributes(buffer: Buffer) {
		// V2 (12 B): NameHashTableIndex, TypeAndLength, NodeIndex
		// V3 (16 B): NameHashTableIndex, TypeAndLength, NextAttributeIndex, Offset
		const isV3 = this.meta.metadataFormat === 1;
		const entrySize = isV3 ? 16 : 12;

		const prevAttributeRefs: number[] = [];
		let dataOffset = 0;
		let off = 0;

		while (off < buffer.length) {
			const typeAndLength = buffer.readUInt32LE(off + 4);
			const attr: LSFAttributeEntry = {
				nameIndex: buffer.readUInt32LE(off),
				type: (typeAndLength & 0x3f) as NodeAttributeType,
				length: typeAndLength >> 6,
				nodeIndex: isV3 ? -1 : buffer.readInt32LE(off + 8),
				nextAttributeIndex: isV3 ? buffer.readInt32LE(off + 8) : -1,
				offset: isV3 ? buffer.readUInt32LE(off + 12) : dataOffset
			};

			if (!isV3) {
				const nodeIndex = attr.nodeIndex + 1;
				if (prevAttributeRefs.length > nodeIndex && prevAttributeRefs[nodeIndex] !== -1) {
					this.attributes[prevAttributeRefs[nodeIndex]].nextAttributeIndex = this.attributes.length;
				}
				while (prevAttributeRefs.length <= nodeIndex) prevAttributeRefs.push(-1);
				prevAttributeRefs[nodeIndex] = this.attributes.length;
				dataOffset += attr.length;
			}

			this.attributes.push(attr);
			off += entrySize;
		}
	}

	private reconstructTree(): LSFNode {
		if (this.nodes.length === 0) throw new Error("No nodes found");
		const rootIndices = this.nodes.map((n, i) => (n.parentIndex === -1 ? i : -1)).filter((i) => i >= 0);
		if (rootIndices.length === 0) throw new Error("No root node found");
		if (rootIndices.length === 1) {
			return this.buildNodeRecursive(rootIndices[0], 0);
		}
		const virtualRoot: LSFNode = { name: "save", attributes: {}, children: [] };
		for (const idx of rootIndices) {
			virtualRoot.children.push(this.buildNodeRecursive(idx, 0));
		}
		return virtualRoot;
	}

	private buildNodeRecursive(nodeIdx: number, depth: number = 0): LSFNode {
		if (depth > 100) throw new Error("Build recursion depth exceeded");
		const nodeEntry = this.nodes[nodeIdx];
		const nodeName = this.resolveName(nodeEntry.nameIndex);

		const node: LSFNode = {
			name: nodeName,
			attributes: {},
			children: []
		};

		let attrIdx = nodeEntry.firstAttributeIndex;
		let runningOffset = 0;
		let visitedAttrs = new Set<number>();

		while (attrIdx !== -1 && attrIdx < this.attributes.length) {
			if (visitedAttrs.has(attrIdx)) break;
			visitedAttrs.add(attrIdx);

			const attrEntry = this.attributes[attrIdx];
			const name = this.resolveName(attrEntry.nameIndex);
			const actualOffset = attrEntry.offset || runningOffset;

			node.attributes[name] = {
				name,
				type: attrEntry.type,
				value: this.readAttributeValue(attrEntry, actualOffset)
			};

			runningOffset = actualOffset + attrEntry.length;
			attrIdx = attrEntry.nextAttributeIndex;
		}

		for (let i = 0; i < this.nodes.length; i++) {
			if (this.nodes[i].parentIndex === nodeIdx) {
				if (i === nodeIdx) continue;
				node.children.push(this.buildNodeRecursive(i, depth + 1));
			}
		}

		return node;
	}

	/** LSF-Format: length bytes, letztes Byte = Null-Terminator */
	private readLsfString(buf: Buffer): string {
		if (buf.length === 0) return "";
		const content = buf.subarray(0, buf.length - 1);
		let lastNonNull = content.length;
		while (lastNonNull > 0 && content[lastNonNull - 1] === 0) lastNonNull--;
		return content.subarray(0, lastNonNull).toString("utf8");
	}

	private formatUuid(buf: Buffer, byteSwap: boolean): string {
		if (buf.length !== 16) return buf.toString("hex");
		let b = buf;
		if (byteSwap) {
			b = Buffer.from(buf);
			for (let i = 8; i < 16; i += 2) {
				[b[i], b[i + 1]] = [b[i + 1], b[i]];
			}
		}
		return [
			b.subarray(0, 4).toString("hex"),
			b.subarray(4, 6).toString("hex"),
			b.subarray(6, 8).toString("hex"),
			b.subarray(8, 10).toString("hex"),
			b.subarray(10, 16).toString("hex")
		].join("-");
	}

	/** DOS2: valueLength, value, handleLength, handle. BG3: +Version (2B) am Anfang */
	private readTranslatedString(buf: Buffer): { value: string; handle: string } {
		let pos = 0;
		if (buf.length < 8) return { value: "", handle: "" };
		const valueLen = buf.readInt32LE(pos);
		pos += 4;
		let value = "";
		if (valueLen > 0 && buf.length >= pos + valueLen) {
			value = this.readLsfString(buf.subarray(pos, pos + valueLen));
			pos += valueLen;
		}
		if (buf.length < pos + 4) return { value, handle: "" };
		const handleLen = buf.readInt32LE(pos);
		pos += 4;
		let handle = "";
		if (handleLen > 0 && buf.length >= pos + handleLen) {
			handle = this.readLsfString(buf.subarray(pos, pos + handleLen));
		}
		return { value, handle };
	}

	/** LSF-Format: value/handle wie TranslatedString, dann arguments mit key, String (rekursiv), value. Gibt auch bytesConsumed zurück. */
	private readTranslatedFSStringWithLength(buf: Buffer): { result: TranslatedFSStringValue; bytesConsumed: number } {
		let pos = 0;
		const isBG3 = this.header.version >= 5;
		let value = "";

		if (buf.length < 4) return { result: { value: "", handle: "" }, bytesConsumed: 0 };
		if (isBG3) {
			if (buf.length < 6) return { result: { value: "", handle: "" }, bytesConsumed: 0 };
			pos += 2; // Version
		} else {
			const valueLen = buf.readInt32LE(pos);
			pos += 4;
			if (valueLen > 0 && buf.length >= pos + valueLen) {
				value = this.readLsfString(buf.subarray(pos, pos + valueLen));
				pos += valueLen;
			}
		}

		if (buf.length < pos + 4) return { result: { value, handle: "" }, bytesConsumed: pos };
		const handleLen = buf.readInt32LE(pos);
		pos += 4;
		let handle = "";
		if (handleLen > 0 && buf.length >= pos + handleLen) {
			handle = this.readLsfString(buf.subarray(pos, pos + handleLen));
			pos += handleLen;
		}

		if (buf.length < pos + 4) return { result: { value, handle }, bytesConsumed: pos };
		const numArgs = buf.readInt32LE(pos);
		pos += 4;
		if (numArgs <= 0) return { result: { value, handle }, bytesConsumed: pos };

		const args: NonNullable<TranslatedFSStringValue["arguments"]> = [];
		for (let i = 0; i < numArgs; i++) {
			if (buf.length < pos + 4) break;
			const keyLen = buf.readInt32LE(pos);
			pos += 4;
			let key = "";
			if (keyLen > 0 && buf.length >= pos + keyLen) {
				key = this.readLsfString(buf.subarray(pos, pos + keyLen));
				pos += keyLen;
			}
			const subBuf = buf.subarray(pos);
			const { result: sub, bytesConsumed: subLen } = this.readTranslatedFSStringWithLength(subBuf);
			pos += subLen;
			if (buf.length < pos + 4) break;
			const valLen = buf.readInt32LE(pos);
			pos += 4;
			let val = "";
			if (valLen > 0 && buf.length >= pos + valLen) {
				val = this.readLsfString(buf.subarray(pos, pos + valLen));
				pos += valLen;
			}
			args.push({ key, value: val, string: sub });
		}
		return { result: { value, handle, arguments: args }, bytesConsumed: pos };
	}

	private readTranslatedFSString(buf: Buffer): TranslatedFSStringValue {
		return this.readTranslatedFSStringWithLength(buf).result;
	}

	private readAttributeValue(attr: LSFAttributeEntry, offset: number): any {
		const buf = this.values.subarray(offset, offset + attr.length);
		if (buf.length === 0 && attr.length > 0) return "";

		switch (attr.type) {
			case NodeAttributeType.Byte:
				return buf.length >= 1 ? buf.readInt8(0) : 0;
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
				return buf.length >= 1 ? buf.readInt8(0) !== 0 : false;
			case NodeAttributeType.IVec2:
				return buf.length >= 8 ? `${buf.readInt32LE(0)} ${buf.readInt32LE(4)}` : buf.toString("hex");
			case NodeAttributeType.IVec3:
				return buf.length >= 12 ? `${buf.readInt32LE(0)} ${buf.readInt32LE(4)} ${buf.readInt32LE(8)}` : buf.toString("hex");
			case NodeAttributeType.IVec4:
				return buf.length >= 16 ? `${buf.readInt32LE(0)} ${buf.readInt32LE(4)} ${buf.readInt32LE(8)} ${buf.readInt32LE(12)}` : buf.toString("hex");
			case NodeAttributeType.Vec2:
				return buf.length >= 8 ? `${buf.readFloatLE(0)} ${buf.readFloatLE(4)}` : buf.toString("hex");
			case NodeAttributeType.Vec3:
				return buf.length >= 12 ? `${buf.readFloatLE(0)} ${buf.readFloatLE(4)} ${buf.readFloatLE(8)}` : buf.toString("hex");
			case NodeAttributeType.Vec4:
				return buf.length >= 16 ? `${buf.readFloatLE(0)} ${buf.readFloatLE(4)} ${buf.readFloatLE(8)} ${buf.readFloatLE(12)}` : buf.toString("hex");
			case NodeAttributeType.String:
			case NodeAttributeType.Path:
			case NodeAttributeType.FixedString:
			case NodeAttributeType.LSString:
			case NodeAttributeType.WString:
			case NodeAttributeType.LSWString:
				return this.readLsfString(buf);
			case NodeAttributeType.UUID:
				return buf.length === 16 ? this.formatUuid(buf, true) : buf.toString("hex");
			case NodeAttributeType.ULongLong:
				return buf.readBigUInt64LE(0).toString();
			case NodeAttributeType.Long:
			case NodeAttributeType.Int64:
				return buf.length >= 8 ? buf.readBigInt64LE(0).toString() : "";
			case NodeAttributeType.Int8:
				return buf.length >= 1 ? buf.readInt8(0) : 0;
			case NodeAttributeType.ScratchBuffer:
				return buf.toString("base64");
			case NodeAttributeType.TranslatedString:
				return this.readTranslatedString(buf);
			case NodeAttributeType.TranslatedFSString:
				return this.readTranslatedFSString(buf);
			default:
				return buf.toString("hex");
		}
	}
}
