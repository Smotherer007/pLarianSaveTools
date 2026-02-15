/**
 * DOS2 Savegame Tools
 *
 * Unpack LSV savegame files (Divinity Original Sin 2)
 * and convert to LSX (XML-like format).
 *
 * Process has 2 stages:
 * 1. Unpack LSV → LSF/LSB files (this module)
 * 2. LSF/LSB → LSX (with Norbyte LSLib/Divine)
 *
 * @example
 * ```ts
 * import { unpackLsv, readPackage } from 'dos2-savegame-tools';
 *
 * // Nur Metadaten lesen
 * const { files } = readPackage('Kiss.lsv');
 * console.log(files.map(f => f.name));
 *
 * // Komplett entpacken
 * unpackLsv('Kiss.lsv', './extracted');
 * ```
 */

export { unpackLsv, readPackage } from "./lsv/unpacker.js";
export type { UnpackOptions } from "./lsv/unpacker.js";
export { packLsv, packLsvFromLsx } from "./lsv/packer.js";
export type { PackLsvOptions } from "./lsv/packer.js";
export type { PackagedFileInfo } from "./lsv/types.js";
export { decompress, decompressLZ4, decompressZlib } from "./lsv/compression.js";
export { LSFReader } from "./lsf/reader.js";
export { writeLsf, writeLsfToBuffer } from "./lsf/writer.js";
export type { LsfVersion, WriteLsfOptions, LSFStringTable } from "./lsf/writer.js";
export { convertLsfToLsx } from "./lsx/lsx-writer.js";
export { parseLsx } from "./lsx/lsx-reader.js";
export type { LsxVersion, LsxOptions } from "./lsx/lsx-writer.js";
export { patchLsfValues, patchLsfValue, patchLsfAtOffset, getLsfValue, getLsfValueAtOffset } from "./lsf/patch.js";
export type { OffsetMap, AttributeOffsetInfo } from "./lsf/patch.js";
