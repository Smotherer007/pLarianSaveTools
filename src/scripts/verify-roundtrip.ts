#!/usr/bin/env node
/**
 * Verifikation gegen Example-Daten
 * --unpack: LSV unpack → Byte-Vergleich mit QuickSave_14_unpacked_lsf (LSLib-Referenz)
 * LSF: Example/QuickSave_14_unpacked_lsf/*.lsf → LSX → LSF → Byte-Vergleich
 * LSV Roundtrip: unpack → pack → Byte-Vergleich
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LSFReader } from "../lsf/reader.js";
import { writeLsf } from "../lsf/writer.js";
import { parseLsx } from "../lsx/lsx-reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import { unpackLsv } from "../lsv/unpacker.js";
import { packLsv } from "../lsv/packer.js";

const EXAMPLE = join(process.cwd(), "Example");
const UNPACKED_LSF = join(EXAMPLE, "QuickSave_14_unpacked_lsf");
const UNPACKED_LSX = join(EXAMPLE, "QuickSave_14_unpacked_lsx");
const ORIGINAL_LSV = join(EXAMPLE, "QuickSave_14", "QuickSave_14.lsv");
const TMP = join(process.cwd(), "tmp-verify");

function collectLsfFiles(dir: string, base = "", quick = false): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory() && !quick) {
			files.push(...collectLsfFiles(dir, rel, quick));
		} else if (entry.name.toLowerCase().endsWith(".lsf")) {
			if (quick && !rel.endsWith("meta.lsf")) continue; // --quick: nur meta.lsf
			files.push(rel);
		}
	}
	return files;
}

function verifyLsfRoundtrip(quick = false) {
	console.log("\n=== LSF Roundtrip (LSF → LSX → LSF) ===\n");
	mkdirSync(TMP, { recursive: true });

	const lsfFiles = collectLsfFiles(UNPACKED_LSF, "", quick);
	if (quick) console.log("(--quick: nur meta.lsf)\n");
	let ok = 0;
	let diff = 0;

	for (const rel of lsfFiles) {
		const origPath = join(UNPACKED_LSF, rel);
		const orig = readFileSync(origPath);
		const reader = new LSFReader(orig);
		const root = reader.read();
		const version = reader.getEngineVersion();

		// LSX-Zwischenschritt
		const lsxPath = join(TMP, rel.replace(/\.lsf$/i, ".lsx"));
		mkdirSync(join(lsxPath, ".."), { recursive: true });
		writeFileSync(lsxPath, convertLsfToLsx(root, version), "utf8");

		// Zurück zu LSF (mit LSLib-Writer)
		const { root: root2, version: lsxVersion } = parseLsx(lsxPath);
		const opts = lsxVersion.major >= 4 ? undefined : { metadataFormat: 0 };
		const roundtripPath = join(TMP, `roundtrip-${rel.replace(/\//g, "_")}`);
		writeLsf(root2, roundtripPath, lsxVersion, opts);
		const roundtrip = readFileSync(roundtripPath);

		const match = orig.equals(roundtrip);
		if (match) {
			console.log(`  OK  ${rel}`);
			ok++;
		} else {
			console.log(`  DIFF ${rel} (orig ${orig.length} B, roundtrip ${roundtrip.length} B)`);
			diff++;
		}
	}

	console.log(`\nLSF: ${ok} identisch, ${diff} abweichend von ${lsfFiles.length} Dateien`);
	return diff === 0;
}

/** LSF→LSX: Unsere Ausgabe byte-identisch mit LSLib-Referenz (QuickSave_14_unpacked_lsx) */
function verifyLsfToLsx(quick = false): boolean {
	console.log("\n=== LSF → LSX (Vergleich mit LSLib-Referenz) ===\n");
	if (!existsSync(UNPACKED_LSX)) {
		console.log("  Übersprungen: QuickSave_14_unpacked_lsx nicht gefunden");
		return true;
	}
	mkdirSync(TMP, { recursive: true });

	const lsfFiles = collectLsfFiles(UNPACKED_LSF, "", quick);
	let ok = 0;
	let diff = 0;

	for (const rel of lsfFiles) {
		const lsxRel = rel.replace(/\.lsf$/i, ".lsx");
		const refPath = join(UNPACKED_LSX, lsxRel);
		if (!existsSync(refPath)) {
			console.log(`  SKIP ${rel} (keine LSX-Referenz)`);
			continue;
		}
		const origPath = join(UNPACKED_LSF, rel);
		const orig = readFileSync(origPath);
		const reader = new LSFReader(orig);
		const root = reader.read();
		const version = reader.getEngineVersion();
		const ourLsx = convertLsfToLsx(root, version);
		const refLsx = readFileSync(refPath, "utf8");

		if (ourLsx === refLsx) {
			console.log(`  OK  ${lsxRel}`);
			ok++;
		} else {
			console.log(`  DIFF ${lsxRel} (ref ${refLsx.length} B, ours ${ourLsx.length} B)`);
			diff++;
		}
	}

	console.log(`\nLSF→LSX: ${ok} identisch, ${diff} abweichend`);
	return diff === 0;
}

function collectAllFiles(dir: string, base: string = ""): string[] {
	const files: string[] = [];
	const opts = { withFileTypes: true } as const;
	for (const entry of readdirSync(join(dir, base), opts)) {
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...collectAllFiles(dir, rel));
		} else if (entry.name !== "__manifest__.json") {
			files.push(rel);
		}
	}
	return files;
}

/** LSV Unpack-Verifikation: Entpackte Dateien byte-identisch mit LSLib-Referenz */
function verifyLsvUnpack(): boolean {
	console.log("\n=== LSV Unpack (LSV → extract, Vergleich mit LSLib-Referenz) ===\n");
	if (!existsSync(ORIGINAL_LSV)) {
		console.log("  Übersprungen: QuickSave_14.lsv nicht gefunden");
		return true;
	}
	if (!existsSync(UNPACKED_LSF)) {
		console.error("  Beispiel-Referenz QuickSave_14_unpacked_lsf nicht gefunden");
		return false;
	}

	mkdirSync(TMP, { recursive: true });
	const unpackDir = join(TMP, "unpacked");
	unpackLsv(ORIGINAL_LSV, unpackDir);

	const refFiles = collectAllFiles(UNPACKED_LSF);
	let ok = 0;
	let diff = 0;
	let missing = 0;

	for (const rel of refFiles) {
		const refPath = join(UNPACKED_LSF, rel);
		const outPath = join(unpackDir, rel);
		if (!existsSync(outPath)) {
			console.log(`  MISSING ${rel}`);
			missing++;
			continue;
		}
		const ref = readFileSync(refPath);
		const out = readFileSync(outPath);
		if (ref.equals(out)) {
			console.log(`  OK  ${rel} (${ref.length} B)`);
			ok++;
		} else {
			console.log(`  DIFF ${rel} (ref ${ref.length} B, ours ${out.length} B)`);
			diff++;
		}
	}

	console.log(`\nLSV Unpack: ${ok} identisch, ${diff} abweichend, ${missing} fehlend von ${refFiles.length} Dateien`);
	return diff === 0 && missing === 0;
}

function verifyLsvRoundtrip() {
	console.log("\n=== LSV Roundtrip (LSV → unpack → pack) ===\n");
	if (!existsSync(ORIGINAL_LSV)) {
		console.log("  Übersprungen: QuickSave_14.lsv nicht gefunden");
		return true;
	}

	mkdirSync(TMP, { recursive: true });
	const unpackDir = join(TMP, "unpacked");
	const repackPath = join(TMP, "repacked.lsv");

	unpackLsv(ORIGINAL_LSV, unpackDir);
	packLsv(unpackDir, repackPath, { version: 13 });

	const orig = readFileSync(ORIGINAL_LSV);
	const repacked = readFileSync(repackPath);

	const match = orig.equals(repacked);
	if (match) {
		console.log("  OK  LSV Roundtrip byte-identisch");
	} else {
		console.log(`  DIFF LSV (orig ${orig.length} B, repacked ${repacked.length} B)`);
	}
	return match;
}

async function main() {
	const quick = process.argv.includes("--quick");
	const unpackOnly = process.argv.includes("--unpack");
	const lsf2lsxOnly = process.argv.includes("--lsf2lsx");
	console.log("pLarianSaveTools – Verifikation");
	console.log("Example-Pfad:", EXAMPLE);

	if (unpackOnly) {
		const unpackOk = verifyLsvUnpack();
		console.log("\n--- Ergebnis ---");
		console.log("LSV Unpack:", unpackOk ? "PASS" : "FAIL");
		process.exit(unpackOk ? 0 : 1);
	}

	if (lsf2lsxOnly) {
		if (!existsSync(UNPACKED_LSF)) {
			console.error("Example/QuickSave_14_unpacked_lsf nicht gefunden");
			process.exit(1);
		}
		const lsxOk = verifyLsfToLsx(quick);
		console.log("\n--- Ergebnis ---");
		console.log("LSF→LSX:", lsxOk ? "PASS" : "FAIL");
		process.exit(lsxOk ? 0 : 1);
	}

	if (!existsSync(UNPACKED_LSF)) {
		console.error("Example/QuickSave_14_unpacked_lsf nicht gefunden");
		process.exit(1);
	}

	const lsfOk = verifyLsfRoundtrip(quick);
	const lsxOk = verifyLsfToLsx(quick);
	const unpackOk = verifyLsvUnpack();
	const lsvOk = verifyLsvRoundtrip();

	console.log("\n--- Ergebnis ---");
	console.log("LSF Roundtrip:", lsfOk ? "PASS" : "FAIL");
	console.log("LSF→LSX:", lsxOk ? "PASS" : "FAIL");
	console.log("LSV Unpack:", unpackOk ? "PASS" : "FAIL");
	console.log("LSV Roundtrip:", lsvOk ? "PASS" : "FAIL");

	process.exit(lsfOk && lsxOk && unpackOk && lsvOk ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
