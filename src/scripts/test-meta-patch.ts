#!/usr/bin/env node
/**
 * Test: meta.lsx Patch-Roundtrip
 * 1. meta.lsx → meta.lsf (convert)
 * 2. LSF lesen, Offset-Map erstellen
 * 3. patchLsfValues(meta.lsf, offsetMap, meta.lsx)
 * 4. Ergebnis mit Original-LSF vergleichen (sollte byte-identisch sein)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LSFReader } from "../lsf/reader.js";
import { writeLsf } from "../lsf/writer.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { patchLsfValues } from "../lsf/patch.js";

const EXAMPLE = join(process.cwd(), "Example", "QuickSave_14_unpacked_lsx");
const META_LSX = join(EXAMPLE, "meta.lsx");
const TMP = join(process.cwd(), "tmp-verify");
const META_LSF = join(TMP, "meta.lsf");

function main() {
	mkdirSync(TMP, { recursive: true });

	if (!existsSync(META_LSX)) {
		console.error("meta.lsx nicht gefunden:", META_LSX);
		process.exit(1);
	}

	console.log("=== meta.lsx Patch-Test ===\n");

	// 1. meta.lsx → meta.lsf
	console.log("1. Konvertiere meta.lsx → meta.lsf");
	const { root, version } = parseLsx(META_LSX);
	const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
	writeLsf(root, META_LSF, version, opts);
	const originalLsf = readFileSync(META_LSF);
	console.log(`   meta.lsf: ${originalLsf.length} Bytes`);

	// 2. Offset-Map aus LSF
	console.log("2. Lese LSF, erstelle Offset-Map");
	const reader = new LSFReader(originalLsf);
	reader.read();
	const offsetMapRaw = reader.getAttributeOffsetMap();
	const offsetMap = {
		attributes: {} as Record<string, { offset: number; length: number; type: number }>
	};
	for (const [path, info] of offsetMapRaw) {
		offsetMap.attributes[path] = { offset: info.offset, length: info.length, type: info.type };
	}
	const attrCount = Object.keys(offsetMap.attributes).length;
	console.log(`   ${attrCount} Attribute in Offset-Map`);

	// 3. Patch
	console.log("3. Patch meta.lsf mit Werten aus meta.lsx");
	const { root: lsxRoot } = parseLsx(META_LSX);
	const patched = patchLsfValues(originalLsf, offsetMap, lsxRoot);
	console.log(`   Gepatcht: ${patched.length} Bytes`);

	// 4. Vergleich
	const match = originalLsf.equals(patched);
	if (match) {
		console.log("\n✓ ERFOLG: Gepatchte LSF ist byte-identisch mit Original");
	} else {
		console.log("\n✗ Abweichung: Gepatchte LSF unterscheidet sich");
		console.log(`  Original: ${originalLsf.length} B, Gepatcht: ${patched.length} B`);
		// Optional: gepatchte Datei speichern zum Debuggen
		writeFileSync(join(TMP, "meta-patched.lsf"), patched);
		console.log("  Gepatchte Datei gespeichert: tmp-verify/meta-patched.lsf");
	}

	process.exit(match ? 0 : 1);
}

main();
