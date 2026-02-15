#!/usr/bin/env node
/**
 * Verifies LSX roundtrip: LSV → extract-lsx → pack-lsx → LSV.
 * Checks whether the repacked LSV is byte-identical to the original.
 *
 * Usage: node dist/scripts/verify-lsx-roundtrip.js [input.lsv]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPackage, extractFileContent } from "../lsv/unpacker.js";
import { packLsvFromLsx } from "../lsv/packer.js";
import { LSFReader } from "../lsf/reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";

const TMP = join(process.cwd(), "tmp-verify-roundtrip");
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

	const quick = process.argv.includes("--quick"); // --quick: meta only (faster test)
	for (const file of files) {
		if (quick && file.name !== "meta.lsf" && file.name.toLowerCase().endsWith(".lsf")) continue;
		const content = extractFileContent(data, file, dataOffset);
		if (file.name.toLowerCase().endsWith(".lsf")) {
			lsfFiles.push({ file, content });
		} else {
			if (!quick) otherFiles.push({ file, content });
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

function main() {
	const inputLsv = process.argv[2] ?? join(process.cwd(), "Example", "QuickSave_14", "QuickSave_14.lsv");

	if (!existsSync(inputLsv)) {
		console.error(`LSV not found: ${inputLsv}`);
		process.exit(1);
	}

	const extractDir = join(TMP, "extracted");
	const repackedPath = join(TMP, "repacked.lsv");

	console.log("\n=== LSX Roundtrip Verification ===\n");
	console.log(`Original: ${inputLsv}\n`);

	// 1. Extract
	console.log("1. extract-lsx (LSV → LSX)...");
	extractLsxFromLsv(inputLsv, extractDir);
	console.log("   Done.\n");

	// 2. Pack
	console.log("2. pack-lsx (LSX → LSV)...");
	packLsvFromLsx(extractDir, repackedPath, { version: 13 });
	console.log("   Done.\n");

	// 3. Compare
	console.log("3. Byte comparison...");
	const original = readFileSync(inputLsv);
	const repacked = readFileSync(repackedPath);

	const match = original.equals(repacked);
	if (match) {
		console.log("\n✓ SUCCESS: Repacked LSV is byte-identical to original");
	} else {
		console.log("\n✗ Difference found:");
		console.log(`  Original:  ${original.length} Bytes`);
		console.log(`  Repacked:  ${repacked.length} Bytes`);
		// Find first difference
		for (let i = 0; i < Math.min(original.length, repacked.length); i++) {
			if (original[i] !== repacked[i]) {
				console.log(`  First difference at offset ${i} (0x${i.toString(16)})`);
				break;
			}
		}
	}

	process.exit(match ? 0 : 1);
}

main();
