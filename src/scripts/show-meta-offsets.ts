#!/usr/bin/env node
/**
 * Zeigt die Offset-Map für meta.lsx:
 * 1. meta.lsx → meta.lsf (Konvertierung)
 * 2. LSF lesen → Offset-Map extrahieren
 * 3. meta.lsx.offsets.json schreiben + Inhalt anzeigen
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LSFReader } from "../lsf/reader.js";
import { writeLsf } from "../lsf/writer.js";
import { parseLsx } from "../lsx/lsx-reader.js";

const EXAMPLE = join(process.cwd(), "Example", "QuickSave_14_unpacked_lsx");
const META_LSX = join(EXAMPLE, "meta.lsx");
const TMP = join(process.cwd(), "tmp-verify");
const META_LSF = join(TMP, "meta.lsf");
const OFFSETS_JSON = join(TMP, "meta.lsx.offsets.json");

function main() {
	mkdirSync(TMP, { recursive: true });

	console.log("=== meta.lsx → Offsets extrahieren ===\n");

	// 1. meta.lsx → meta.lsf
	console.log("1. Konvertiere meta.lsx → meta.lsf");
	const { root, version } = parseLsx(META_LSX);
	const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
	writeLsf(root, META_LSF, version, opts);
	console.log(`   → ${META_LSF}\n`);

	// 2. LSF lesen, Offset-Map
	console.log("2. Lese LSF, extrahiere Offset-Map");
	const originalLsf = readFileSync(META_LSF);
	const reader = new LSFReader(originalLsf);
	reader.read();
	const offsetMap = reader.getAttributeOffsetMap();

	const offsetsJson: Record<string, { offset: number; length: number; type: number }> = {};
	for (const [path, info] of offsetMap) {
		offsetsJson[path] = { offset: info.offset, length: info.length, type: info.type };
	}

	// 3. Schreiben
	writeFileSync(OFFSETS_JSON, JSON.stringify({ attributes: offsetsJson }, null, 2), "utf8");
	writeFileSync(join(TMP, "meta.lsx.base.lsf"), originalLsf);
	writeFileSync(join(TMP, "meta.lsx"), readFileSync(META_LSX));
	console.log(`   → ${OFFSETS_JSON}`);
	console.log(`   → ${join(TMP, "meta.lsx.base.lsf")}`);
	console.log(`   → ${join(TMP, "meta.lsx")} (Kopie)\n`);

	// 4. Inhalt anzeigen
	console.log("3. Offset-Map (Pfad → { offset, length, type }):\n");
	for (const [path, info] of Object.entries(offsetsJson)) {
		console.log(`   ${path}`);
		console.log(`      offset: ${info.offset}, length: ${info.length}, type: ${info.type}`);
	}
}

main();
