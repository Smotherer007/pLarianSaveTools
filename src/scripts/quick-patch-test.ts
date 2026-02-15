#!/usr/bin/env node
/**
 * Quick patch test: LSV → extract-lsx → edit meta.lsx → patch → pack
 * Much faster than full pack-lsx since only meta is patched.
 *
 * Usage:
 *   node dist/scripts/quick-patch-test.js [input.lsv]     - Full: extract → patch → pack
 *   node dist/scripts/quick-patch-test.js --dir <folder>  - Quick: patch → pack only (already extracted)
 *   Without LSV: uses ./QuickSave_14.lsv or ./QuickSave_14_repacked.lsv
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPackage, extractFileContent } from "../lsv/unpacker.js";
import { packLsvFromLsx } from "../lsv/packer.js";
import { LSFReader } from "../lsf/reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import { patchLsfValues } from "../lsf/patch.js";
import { parseLsx } from "../lsx/lsx-reader.js";

const TMP = join(process.cwd(), "extracted-patch-test");
const MANIFEST_NAME = "__manifest__.json";

function toLsxPath(name: string) {
	return name.replace(/\.lsf$/i, ".lsx");
}

function extractLsxFromLsv(inputLsv: string, outputDir: string): void {
	const { files, data, header } = readPackage(inputLsv);
	const dataOffset = header.headerAtStart || header.version > 10 ? 0 : header.fileListOffset + 32;

	mkdirSync(outputDir, { recursive: true });

	const lsfFiles: Array<{ file: (typeof files)[0]; content: Buffer }> = [];
	const otherFiles: Array<{ file: (typeof files)[0]; content: Buffer }> = [];

	for (const file of files) {
		const content = extractFileContent(data, file, dataOffset);
		if (file.name.toLowerCase().endsWith(".lsf")) {
			lsfFiles.push({ file, content });
		} else {
			otherFiles.push({ file, content });
		}
	}

	const manifestFiles: { name: string; flags: number }[] = [];

	for (const { file, content } of lsfFiles) {
		const lsxPath = join(outputDir, toLsxPath(file.name));
		mkdirSync(join(lsxPath, ".."), { recursive: true });

		const reader = new LSFReader(content);
		const root = reader.read();
		const lsx = convertLsfToLsx(root, reader.getEngineVersion());
		writeFileSync(lsxPath, lsx, "utf8");

		const offsetMap = reader.getAttributeOffsetMap();
		const offsetsJson: Record<string, { offset: number; length: number; type: number }> = {};
		for (const [path, info] of offsetMap) {
			offsetsJson[path] = { offset: info.offset, length: info.length, type: info.type };
		}
		writeFileSync(lsxPath + ".offsets.json", JSON.stringify({ attributes: offsetsJson }, null, 0), "utf8");
		writeFileSync(lsxPath + ".base.lsf", content);

		manifestFiles.push({ name: toLsxPath(file.name), flags: file.flags ?? 33 });
	}

	for (const { file, content } of otherFiles) {
		const outPath = join(outputDir, file.name);
		mkdirSync(join(outPath, ".."), { recursive: true });
		writeFileSync(outPath, content);
		manifestFiles.push({ name: file.name, flags: file.flags ?? 33 });
	}

	const manifest = {
		version: header.version,
		files: manifestFiles
	};
	if (header.flags !== undefined) (manifest as any).flags = header.flags;
	if (header.priority !== undefined) (manifest as any).priority = header.priority;
	writeFileSync(join(outputDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), "utf8");
}

/** Small change in meta.lsx (Difficulty) for quick test */
function applyTestChange(metaLsxPath: string): void {
	let xml = readFileSync(metaLsxPath, "utf8");
	// Difficulty: 0=Story, 1=Classic, 2=Tactician, 3=Honour
	const match = xml.match(/<attribute id="Difficulty" value="(\d)"/);
	if (match) {
		const oldVal = match[1];
		const newVal = oldVal === "2" ? "1" : "2"; // Tactician ↔ Classic
		xml = xml.replace(`<attribute id="Difficulty" value="${oldVal}"`, `<attribute id="Difficulty" value="${newVal}"`);
		writeFileSync(metaLsxPath, xml, "utf8");
		console.log(`   meta.lsx: Difficulty ${oldVal} → ${newVal} (test change)`);
	} else {
		console.log("   meta.lsx: No Difficulty found, unchanged");
	}
}

function main() {
	const dirIdx = process.argv.indexOf("--dir");
	const useExistingDir = dirIdx >= 0 && process.argv[dirIdx + 1];
	const existingDir = useExistingDir ? process.argv[dirIdx + 1] : null;

	let workDir: string;
	let repackedPath: string;

	if (existingDir && existsSync(existingDir)) {
		workDir = existingDir;
		repackedPath = join(process.cwd(), "QuickSave_14_patch_test.lsv");
		console.log("\n=== Schneller Patch-Test (nur patch + pack) ===\n");
		console.log(`Ordner: ${workDir}`);
		console.log(`Output: ${repackedPath}\n`);
	} else {
		const candidates = [
			!useExistingDir && process.argv[2],
			join(process.cwd(), "QuickSave_14.lsv"),
			join(process.cwd(), "QuickSave_14_repacked.lsv"),
			join(process.cwd(), "Example", "QuickSave_14", "QuickSave_14.lsv")
		].filter(Boolean) as string[];

		const inputLsv = candidates.find((p) => typeof p === "string" && existsSync(p));
		if (!inputLsv) {
			console.error("Verwendung:");
			console.error("  node dist/scripts/quick-patch-test.js <input.lsv>");
			console.error("  node dist/scripts/quick-patch-test.js --dir <extracted-folder>  # Schnell: nur patch+pack");
			console.error("  Or place QuickSave_14.lsv in project directory.");
			process.exit(1);
		}

		repackedPath = join(process.cwd(), "QuickSave_14_patch_test.lsv");
		console.log("\n=== Schneller Patch-Test ===\n");
		console.log(`LSV: ${inputLsv}`);
		console.log(`Output: ${repackedPath}\n`);

		// 1. Extract
		console.log("1. extract-lsx...");
		extractLsxFromLsv(inputLsv, TMP);
		console.log("   Done.\n");
		workDir = TMP;
	}

	const metaLsx = join(workDir, "meta.lsx");
	if (!existsSync(metaLsx)) {
		console.error("meta.lsx not found");
		process.exit(1);
	}

	// 2. Test-Änderung
	console.log("2. Test-Änderung in meta.lsx...");
	applyTestChange(metaLsx);
	console.log("");

	// 3. Patch (nur meta.lsf, schnell)
	console.log("3. patch meta.lsx → meta.lsf...");
	const offsetsPath = metaLsx + ".offsets.json";
	const baseLsfPath = metaLsx + ".base.lsf";
	const origLsfPath = metaLsx.replace(/\.lsx$/i, ".lsf");
	// .base.lsf (extract-lsx) or meta.lsf (unpack+convert) as original base
	const basePath = existsSync(baseLsfPath) ? baseLsfPath : (existsSync(origLsfPath) ? origLsfPath : null);
	if (!basePath || !existsSync(offsetsPath)) {
		console.error("Error: meta.lsx requires .offsets.json and .lsf or .base.lsf");
		process.exit(1);
	}
	const baseLsf = readFileSync(basePath);
	const offsetMap = JSON.parse(readFileSync(offsetsPath, "utf8")) as {
		attributes: Record<string, { offset: number; length: number; type: number }>;
	};
	const { root } = parseLsx(metaLsx);
	const patched = patchLsfValues(baseLsf, offsetMap, root);
	writeFileSync(metaLsx.replace(/\.lsx$/i, ".lsf"), patched);
	console.log("   Fertig.\n");

	// 4. Pack
	console.log("4. pack-lsx...");
	packLsvFromLsx(workDir, repackedPath, { version: 13 });
	console.log("   Fertig.\n");

		console.log(`✓ ${repackedPath} created – test in game.\n`);
}

main();
