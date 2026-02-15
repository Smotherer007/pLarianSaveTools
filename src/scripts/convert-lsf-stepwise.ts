#!/usr/bin/env node
/**
 * Converts LSF files one by one to LSX and shows manifest creation.
 * Usage: node dist/scripts/convert-lsf-stepwise.js <input.lsv> [outputDir]
 * Or: node dist/scripts/convert-lsf-stepwise.js <lsf-directory> [outputDir]
 *
 * For LSV: unpacks, converts each LSF individually, creates __manifest__.json
 * For directory: converts each LSF in the directory to LSX
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { LSFReader } from "../lsf/reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import { readPackage, extractFileContent } from "../lsv/unpacker.js";

const MANIFEST_NAME = "__manifest__.json";

function collectLsfFiles(dir: string, base = ""): Array<{ rel: string; fullPath: string }> {
	const result: Array<{ rel: string; fullPath: string }> = [];
	for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
		const rel = base ? `${base}/${entry.name}` : entry.name;
		const fullPath = join(dir, rel);
		if (entry.isDirectory() && !entry.name.startsWith(".")) {
			result.push(...collectLsfFiles(dir, rel));
		} else if (entry.name.toLowerCase().endsWith(".lsf") && !entry.name.endsWith(".base.lsf")) {
			result.push({ rel, fullPath });
		}
	}
	return result.sort((a, b) => a.rel.localeCompare(b.rel));
}

function main() {
	const inputPath = process.argv[2] ?? "";
	const outputDir = process.argv[3] ?? join(process.cwd(), "converted-lsx");

	if (!inputPath) {
		console.error("Usage: node convert-lsf-stepwise.js <input.lsv|lsf-directory> [outputDir]");
		process.exit(1);
	}

	if (!existsSync(inputPath)) {
		console.error(`Not found: ${inputPath}`);
		process.exit(1);
	}

	mkdirSync(outputDir, { recursive: true });

	const stat = statSync(inputPath);
	let lsfEntries: Array<{ name: string; content: Buffer; flags: number }>;

	if (stat.isFile() && inputPath.toLowerCase().endsWith(".lsv")) {
		console.log(`\n=== Unpacking LSV: ${inputPath} ===\n`);
		const { files, data, header } = readPackage(inputPath);
		const dataOffset = header.headerAtStart || header.version > 10 ? 0 : header.fileListOffset + 32;
		lsfEntries = [];
		for (const file of files) {
			if (!file.name.toLowerCase().endsWith(".lsf")) continue;
			const content = extractFileContent(data, file, dataOffset);
			lsfEntries.push({ name: file.name, content, flags: file.flags ?? 33 });
		}
		console.log(`${lsfEntries.length} LSF files found in LSV.\n`);
	} else if (stat.isDirectory()) {
		console.log(`\n=== LSF directory: ${inputPath} ===\n`);
		const found = collectLsfFiles(inputPath);
		lsfEntries = found.map(({ rel, fullPath }) => ({
			name: rel,
			content: readFileSync(fullPath),
			flags: 33
		}));
		console.log(`${lsfEntries.length} LSF files found.\n`);
	} else {
		console.error("Input must be a .lsv file or a directory with .lsf files.");
		process.exit(1);
	}

	const manifestFiles: { name: string; flags: number }[] = [];
	const toLsxPath = (name: string) => name.replace(/\.lsf$/i, ".lsx");

	console.log("--- Conversion (one by one) ---\n");

	for (let i = 0; i < lsfEntries.length; i++) {
		const { name, content, flags } = lsfEntries[i];
		const lsxName = toLsxPath(name);
		const lsxPath = join(outputDir, lsxName);

		console.log(`  [${i + 1}/${lsfEntries.length}] ${name} → ${lsxName}`);

		mkdirSync(dirname(lsxPath), { recursive: true });

		const reader = new LSFReader(content);
		const root = reader.read();
		const lsx = convertLsfToLsx(root, reader.getEngineVersion());
		writeFileSync(lsxPath, lsx, "utf8");

		manifestFiles.push({ name: lsxName, flags });
	}

	console.log("\n--- Create manifest ---\n");

	const manifest = {
		version: 13,
		files: manifestFiles
	};
	const manifestPath = join(outputDir, MANIFEST_NAME);
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

	console.log(`  ${MANIFEST_NAME}:`);
	console.log(JSON.stringify(manifest, null, 2));
	console.log(`\n  → ${manifestPath}`);

	console.log("\n=== Done ===\n");
}

main();
