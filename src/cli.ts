#!/usr/bin/env node
/**
 * CLI für DOS2 Savegame Tools
 * Verwendung:
 *   unpack <input.lsv> [outputDir]
 *   convert <input.lsf> [output.lsx]   - LSF zu LSX (benötigt Divine)
 *   convert <dir>                      - Alle LSF in Verzeichnis konvertieren
 */

import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { unpackLsv } from "./lsv/unpacker.js";
import { packLsv } from "./lsv/packer.js";
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
  unpack <input.lsv> [outputDir] --manifest  - Mit Manifest für pack
  pack <inputDir> [output.lsv]          - Verzeichnis zurück zu LSV packen
  convert <input.lsf> [output.lsx]      - LSF zu LSX konvertieren
  convert <input.lsx> [output.lsf]      - LSX zu LSF konvertieren

Beispiele:
  node dist/cli.js unpack Kiss.lsv ./extracted --manifest
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
		const manifest = args.includes("--manifest");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Datei nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		mkdirSync(outputDir, { recursive: true });
		console.log(`Entpacke ${inputPath} nach ${outputDir}${manifest ? " (mit Manifest)" : ""}...`);
		const extracted = unpackLsv(inputPath, outputDir, { manifest });
		console.log(`Fertig: ${extracted.length} Dateien extrahiert`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "pack") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Fehler: Verzeichnis nicht gefunden: ${inputPath}`);
			process.exit(1);
		}
		console.log(`Packe ${inputPath} → ${output}...`);
		packLsv(inputPath, output);
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
			writeLsf(root, output, version);
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
