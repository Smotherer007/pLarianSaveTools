#!/usr/bin/env node
/**
 * CLI für DOS2 Savegame Tools
 * Verwendung:
 *   unpack <input.lsv> [outputDir]
 *   extract-lsx <input.lsv> [outputDir] - LSV direkt zu LSX (nur LSX-Dateien)
 *   convert <input.lsf> [output.lsx]   - LSF zu LSX
 *   convert <input.lsx> [output.lsf]   - LSX zu LSF
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { unpackLsv, readPackage, extractFileContent } from "./lsv/unpacker.js";
const MANIFEST_NAME = "__manifest__.json";
import { packLsv, packLsvFromLsx } from "./lsv/packer.js";
import { LSFReader } from "./lsf/reader.js";
import { convertLsfToLsx } from "./lsx/lsx-writer.js";
import { parseLsx } from "./lsx/lsx-reader.js";
import { writeLsf } from "./lsf/writer.js";
import { patchLsfValues } from "./lsf/patch.js";

const args = process.argv.slice(2);
const command = args[0];
const inputPath = args[1];
const outputPath = args[2];

const HELP = `
DOS2 Savegame Tools - LSV Entpacker & LSF↔LSX Konverter

Verwendung:
  unpack <input.lsv> [outputDir]        - LSV entpacken (LSF-Dateien extrahieren)
  extract-lsx <input.lsv> [outputDir]   - LSV → LSX + PNG etc.
  pack-lsx <inputDir> [output.lsv]      - LSX-Ordner zurück zu LSV packen
  pack <inputDir> [output.lsv]         - Verzeichnis (LSF) zurück zu LSV packen
  pack-lsx ... --cleanup                - LSX, .offsets.json, .base.lsf nach Packen löschen
  patch <input.lsx> [output.lsf]        - LSX-Änderungen in LSF überführen (ohne LSV-Packen)
  patch <inputDir> [--cleanup]           - Alle LSX im Ordner patchen
  convert <input.lsf> [output.lsx]       - LSF zu LSX konvertieren
  convert <input.lsx> [output.lsf]      - LSX zu LSF konvertieren

Beispiele:
  node dist/cli.js unpack Kiss.lsv ./extracted
  node dist/cli.js extract-lsx Kiss.lsv ./lsx-only
  node dist/cli.js pack-lsx ./lsx-only Kiss_repacked.lsv
  node dist/cli.js pack ./extracted Kiss_repacked.lsv
  node dist/cli.js patch ./extracted/meta.lsx --cleanup
  node dist/cli.js patch ./extracted --cleanup
  node dist/cli.js convert meta.lsf meta.lsx
`;

if (!command || args.includes("--help") || args.includes("-h") || command === "help") {
	console.log(HELP);
	process.exit(command ? 0 : 1);
}

if (!inputPath) {
	console.error(HELP);
	process.exit(1);
}

try {
	if (command === "unpack") {
		const outputDir = outputPath ?? join(process.cwd(), "extracted");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Datei nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		mkdirSync(outputDir, { recursive: true });
		console.log(`Entpacke ${inputPath} nach ${outputDir}...`);
		const extracted = unpackLsv(inputPath, outputDir);
		console.log(`Fertig: ${extracted.length} Dateien extrahiert`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "extract-lsx") {
		const outputDir = outputPath ?? join(process.cwd(), "extracted-lsx");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Datei nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		mkdirSync(outputDir, { recursive: true });
		console.log(`Entpacke ${inputPath} → LSX nach ${outputDir}...`);
		const { files, data, header } = readPackage(inputPath);
		const dataOffset = header.headerAtStart || header.version > 10 ? 0 : header.fileListOffset + 32;
		const extracted: string[] = [];
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

		const toLsxPath = (name: string) => name.replace(/\.lsf$/i, ".lsx");
		const allDirs = new Set<string>();
		for (const { file } of lsfFiles) {
			allDirs.add(dirname(join(outputDir, toLsxPath(file.name))));
		}
		for (const { file } of otherFiles) {
			allDirs.add(dirname(join(outputDir, file.name)));
		}
		for (const d of allDirs) mkdirSync(d, { recursive: true });

		for (const { file, content } of lsfFiles) {
			const reader = new LSFReader(content);
			const root = reader.read();
			const lsx = convertLsfToLsx(root, reader.getEngineVersion());
			const lsxPath = join(outputDir, toLsxPath(file.name));
			writeFileSync(lsxPath, lsx, "utf8");
			extracted.push(lsxPath);
			const offsetMap = reader.getAttributeOffsetMap();
			const offsetsJson: Record<string, { offset: number; length: number; type: number }> = {};
			for (const [path, info] of offsetMap) {
				offsetsJson[path] = { offset: info.offset, length: info.length, type: info.type };
			}
			const offsetsPath = lsxPath + ".offsets.json";
			writeFileSync(offsetsPath, JSON.stringify({ attributes: offsetsJson }, null, 0), "utf8");
			extracted.push(offsetsPath);
			const baseLsfPath = lsxPath + ".base.lsf";
			writeFileSync(baseLsfPath, content);
			extracted.push(baseLsfPath);
		}

		for (const { file, content } of otherFiles) {
			writeFileSync(join(outputDir, file.name), content, { flag: "w" });
			extracted.push(join(outputDir, file.name));
		}

		const manifestFiles = lsfFiles.map(({ file }) => ({
			name: toLsxPath(file.name),
			flags: file.flags ?? 33
		}));
		for (const { file } of otherFiles) {
			manifestFiles.push({ name: file.name, flags: file.flags ?? 33 });
		}
		if (manifestFiles.length > 0) {
			const manifest: {
				version: number;
				flags?: number;
				priority?: number;
				files: { name: string; flags: number }[];
			} = {
				version: header.version,
				files: manifestFiles
			};
			if (header.flags !== undefined) manifest.flags = header.flags;
			if (header.priority !== undefined) manifest.priority = header.priority;
			writeFileSync(join(outputDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), "utf8");
			extracted.push(join(outputDir, MANIFEST_NAME));
		}

		console.log(`Fertig: ${extracted.length} Dateien erstellt`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "pack-lsx") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Verzeichnis nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		const cleanup = args.includes("--cleanup");
		console.log(`Packe LSX-Ordner ${inputPath} → ${output}...`);
		packLsvFromLsx(inputPath, output, { version: 13 });
		console.log(`Fertig: ${output} erstellt`);
		if (cleanup) {
			const deleted: string[] = [];
			function walk(base: string) {
				for (const entry of readdirSync(join(inputPath, base), { withFileTypes: true })) {
					const rel = base ? `${base}/${entry.name}` : entry.name;
					if (entry.isDirectory()) {
						if (!entry.name.startsWith(".")) walk(rel);
					} else if (
						entry.name.endsWith(".lsx") ||
						entry.name.endsWith(".offsets.json") ||
						entry.name.endsWith(".base.lsf")
					) {
						const p = join(inputPath, rel);
						unlinkSync(p);
						deleted.push(rel);
					}
				}
			}
			walk("");
			if (deleted.length > 0) {
				console.log(`Aufgeräumt: ${deleted.length} Dateien gelöscht`);
				deleted.forEach((f) => console.log(`  - ${f}`));
			}
		}
	} else if (command === "pack") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Verzeichnis nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		console.log(`Packe ${inputPath} → ${output}...`);
		packLsv(inputPath, output, { version: 13 });
		console.log(`Fertig: ${output} erstellt`);
	} else if (command === "convert") {
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Datei nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		const isLsf = inputPath.toLowerCase().endsWith(".lsf");
		const output = outputPath ?? (isLsf ? inputPath.replace(/\.lsf$/i, ".lsx") : inputPath.replace(/\.lsx$/i, ".lsf"));
		console.log(`Konvertiere ${inputPath} → ${output}...`);

		if (isLsf) {
			const content = readFileSync(inputPath);
			const reader = new LSFReader(content);
			const root = reader.read();
			const lsx = convertLsfToLsx(root, reader.getEngineVersion());
			writeFileSync(output, lsx, "utf8");
			// Offsets + Base für Patch-Workflow (pack-lsx nutzt patchLsfValues)
			const offsetMap = reader.getAttributeOffsetMap();
			const offsetsJson: Record<string, { offset: number; length: number; type: number }> = {};
			for (const [path, info] of offsetMap) {
				offsetsJson[path] = { offset: info.offset, length: info.length, type: info.type };
			}
			writeFileSync(output + ".offsets.json", JSON.stringify({ attributes: offsetsJson }, null, 0), "utf8");
		} else {
			const { root, version } = parseLsx(inputPath);
			const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
			writeLsf(root, output, version, opts);
		}
		console.log(`Fertig: ${output} erstellt`);
	} else if (command === "patch") {
		const cleanup = args.includes("--cleanup");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		const doPatch = (lsxPath: string): { lsxPath: string; offsetsPath: string; baseLsfPath: string } => {
			const offsetsPath = lsxPath + ".offsets.json";
			const baseLsfPath = lsxPath + ".base.lsf";
			const lsfPath = lsxPath.replace(/\.lsx$/i, ".lsf");
			const basePath = existsSync(baseLsfPath) ? baseLsfPath : (existsSync(lsfPath) ? lsfPath : null);
			if (!existsSync(offsetsPath) || !basePath) {
				console.error(`Fehler: ${lsxPath} benötigt .offsets.json und .lsf/.base.lsf`);
				process.exit(1);
			}
			const baseLsf = readFileSync(basePath);
			const offsetMap = JSON.parse(readFileSync(offsetsPath, "utf8")) as {
				attributes: Record<string, { offset: number; length: number; type: number }>;
			};
			const { root } = parseLsx(lsxPath);
			const patched = patchLsfValues(baseLsf, offsetMap, root);
			writeFileSync(lsfPath, patched);
			console.log(`  ${lsxPath} → ${lsfPath}`);
			return { lsxPath, offsetsPath, baseLsfPath };
		};
		const toDelete: string[] = [];
		if (inputPath.toLowerCase().endsWith(".lsx")) {
			console.log(`Patche ${inputPath} → LSF...`);
			const { lsxPath, offsetsPath, baseLsfPath } = doPatch(inputPath);
			if (cleanup) {
				toDelete.push(lsxPath, offsetsPath);
				if (existsSync(baseLsfPath)) toDelete.push(baseLsfPath);
			}
		} else {
			console.log(`Patche LSX-Dateien in ${inputPath}...`);
			function walk(base: string) {
				for (const entry of readdirSync(join(inputPath, base), { withFileTypes: true })) {
					const rel = base ? `${base}/${entry.name}` : entry.name;
					if (entry.isDirectory()) {
						if (!entry.name.startsWith(".")) walk(rel);
					} else if (entry.name.endsWith(".lsx")) {
						const lsxPath = join(inputPath, rel);
						doPatch(lsxPath);
						if (cleanup) {
							toDelete.push(lsxPath, lsxPath + ".offsets.json");
							if (existsSync(lsxPath + ".base.lsf")) toDelete.push(lsxPath + ".base.lsf");
						}
					}
				}
			}
			walk("");
		}
		for (const p of toDelete) {
			if (existsSync(p)) {
				unlinkSync(p);
				console.log(`  Gelöscht: ${p}`);
			}
		}
		console.log("Fertig");
	} else {
		console.error(`Unbekannter Befehl: ${command}`);
		process.exit(1);
	}
} catch (err) {
	console.error("Fehler:", err instanceof Error ? err.message : err);
	process.exit(1);
}
