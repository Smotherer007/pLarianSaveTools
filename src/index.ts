/**
 * DOS2 Savegame Tools
 *
 * Ermöglicht das Entpacken von LSV-Savegame-Dateien (Divinity Original Sin 2)
 * und die Konvertierung zu LSX (XML-ähnliches Format).
 *
 * Der Prozess hat 2 Stufen:
 * 1. LSV entpacken → LSF/LSB Dateien (dieses Modul)
 * 2. LSF/LSB → LSX (mit Norbyte LSLib/Divine)
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
export { packLsv } from "./lsv/packer.js";
export type { PackManifest } from "./lsv/packer.js";
export type { PackagedFileInfo } from "./lsv/types.js";
export { decompress, decompressLZ4, decompressZlib } from "./lsv/compression.js";
export { LSFReader } from "./lsf/reader.js";
export { writeLsf } from "./lsf/writer.js";
export type { LsfVersion } from "./lsf/writer.js";
export { convertLsfToLsx } from "./lsx/lsx-writer.js";
export { parseLsx } from "./lsx/lsx-reader.js";
export type { LsxVersion, LsxOptions } from "./lsx/lsx-writer.js";
