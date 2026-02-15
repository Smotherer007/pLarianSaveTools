#!/usr/bin/env node
/**
 * Konvertiert LSF-Dateien eine nach der anderen zu LSX und zeigt die Manifest-Erstellung.
 * Verwendung: node dist/scripts/convert-lsf-stepwise.js <input.lsv> [outputDir]
 * Oder: node dist/scripts/convert-lsf-stepwise.js <lsf-verzeichnis> [outputDir]
 *
 * Bei LSV: entpackt, konvertiert jede LSF einzeln, erstellt __manifest__.json
 * Bei Verzeichnis: konvertiert jede LSF im Verzeichnis zu LSX
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
		console.error("Verwendung: node convert-lsf-stepwise.js <input.lsv|lsf-verzeichnis> [outputDir]");
		process.exit(1);
	}

	if (!existsSync(inputPath)) {
		console.error(`Nicht gefunden: ${inputPath}`);
		process.exit(1);
	}

	mkdirSync(outputDir, { recursive: true });

	const stat = statSync(inputPath);
	let lsfEntries: Array<{ name: string; content: Buffer; flags: number }>;

	if (stat.isFile() && inputPath.toLowerCase().endsWith(".lsv")) {
		console.log(`\n=== LSV entpacken: ${inputPath} ===\n`);
		const { files, data, header } = readPackage(inputPath);
		const dataOffset = header.headerAtStart || header.version > 10 ? 0 : header.fileListOffset + 32;
		lsfEntries = [];
		for (const file of files) {
			if (!file.name.toLowerCase().endsWith(".lsf")) continue;
			const content = extractFileContent(data, file, dataOffset);
			lsfEntries.push({ name: file.name, content, flags: file.flags ?? 33 });
		}
		console.log(`${lsfEntries.length} LSF-Dateien in LSV gefunden.\n`);
	} else if (stat.isDirectory()) {
		console.log(`\n=== LSF-Verzeichnis: ${inputPath} ===\n`);
		const found = collectLsfFiles(inputPath);
		lsfEntries = found.map(({ rel, fullPath }) => ({
			name: rel,
			content: readFileSync(fullPath),
			flags: 33
		}));
		console.log(`${lsfEntries.length} LSF-Dateien gefunden.\n`);
	} else {
		console.error("Input muss eine .lsv Datei oder ein Verzeichnis mit .lsf Dateien sein.");
		process.exit(1);
	}

	const manifestFiles: { name: string; flags: number }[] = [];
	const toLsxPath = (name: string) => name.replace(/\.lsf$/i, ".lsx");

	console.log("--- Konvertierung (eine nach der anderen) ---\n");

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

	console.log("\n--- Manifest erstellen ---\n");

	const manifest = {
		version: 13,
		files: manifestFiles
	};
	const manifestPath = join(outputDir, MANIFEST_NAME);
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

	console.log(`  ${MANIFEST_NAME}:`);
	console.log(JSON.stringify(manifest, null, 2));
	console.log(`\n  → ${manifestPath}`);

	console.log("\n=== Fertig ===\n");
}

main();
