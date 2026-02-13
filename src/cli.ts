#!/usr/bin/env node
/**
 * CLI für DOS2 Savegame Tools
 * Verwendung:
 *   unpack <input.lsv> [outputDir]
 *   extract-lsx <input.lsv> [outputDir] - LSV direkt zu LSX (nur LSX-Dateien)
 *   convert <input.lsf> [output.lsx]   - LSF zu LSX
 *   convert <input.lsx> [output.lsf]   - LSX zu LSF
 */

import { existsSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { unpackLsv, readPackage, extractFileContent } from "./lsv/unpacker.js";
import { packLsv, packLsvFromLsx } from "./lsv/packer.js";
import { LSFReader } from "./lsf/reader.js";
import { convertLsfToLsx } from "./lsx/lsx-writer.js";
import { parseLsx } from "./lsx/lsx-reader.js";
import { writeLsf } from "./lsf/writer.js";

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
  pack <inputDir> [output.lsv]          - Verzeichnis (LSF) zurück zu LSV packen
  pack/pack-lsx ... --game dos2|bg3     - Version (default: dos2)
  convert <input.lsf> [output.lsx]       - LSF zu LSX konvertieren
  convert <input.lsx> [output.lsf]      - LSX zu LSF konvertieren

Beispiele:
  node dist/cli.js unpack Kiss.lsv ./extracted
  node dist/cli.js extract-lsx Kiss.lsv ./lsx-only
  node dist/cli.js pack-lsx ./lsx-only Kiss_repacked.lsv
  node dist/cli.js pack ./extracted Kiss_repacked.lsv
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
		}

		for (const { file, content } of otherFiles) {
			writeFileSync(join(outputDir, file.name), content, { flag: "w" });
			extracted.push(join(outputDir, file.name));
		}

		console.log(`Fertig: ${extracted.length} Dateien erstellt`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "pack-lsx") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Verzeichnis nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		const gameIdx = args.indexOf("--game");
		const version = gameIdx >= 0 && args[gameIdx + 1] === "bg3" ? 18 : 13;
		console.log(`Packe LSX-Ordner ${inputPath} → ${output}...`);
		packLsvFromLsx(inputPath, output, { version });
		console.log(`Fertig: ${output} erstellt`);
	} else if (command === "pack") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Verzeichnis nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		const gameIdx = args.indexOf("--game");
		const version = gameIdx >= 0 && args[gameIdx + 1] === "bg3" ? 18 : 13;
		console.log(`Packe ${inputPath} → ${output}...`);
		packLsv(inputPath, output, { version });
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
			const reader = new LSFReader(inputPath);
			const root = reader.read();
			const lsx = convertLsfToLsx(root, reader.getEngineVersion());
			writeFileSync(output, lsx, "utf8");
		} else {
			const { root, version } = parseLsx(inputPath);
			const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
			writeLsf(root, output, version, opts);
		}
		console.log(`Fertig: ${output} erstellt`);
	} else {
		console.error(`Unbekannter Befehl: ${command}`);
		process.exit(1);
	}
} catch (err) {
	console.error("Fehler:", err instanceof Error ? err.message : err);
	process.exit(1);
}
