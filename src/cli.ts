#!/usr/bin/env node
/**
 * CLI for DOS2 Savegame Tools
 * Usage:
 *   unpack <input.lsv> [outputDir]
 *   extract-lsx <input.lsv> [outputDir] - LSV directly to LSX (LSX files only)
 *   convert <input.lsf> [output.lsx]   - LSF to LSX
 *   convert <input.lsx> [output.lsf]   - LSX to LSF
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
import { patchLsfValues, patchLsfValue, getLsfValue } from "./lsf/patch.js";

const args = process.argv.slice(2);
const command = args[0];
const inputPath = args[1];
const outputPath = args[2];

const HELP = `
DOS2 Savegame Tools - LSV Entpacker & LSF↔LSX Konverter

Verwendung:
  unpack <input.lsv> [outputDir]        - Extract LSV (LSF files)
  extract-lsx <input.lsv> [outputDir]   - LSV → LSX + PNG etc.
  pack-lsx <inputDir> [output.lsv]      - Pack LSX folder back to LSV
  pack <inputDir> [output.lsv]         - Pack directory (LSF) back to LSV
  pack-lsx ... --cleanup                - Remove LSX, .offsets.json, .base.lsf after packing
  patch <input.lsx> [output.lsf]        - Apply LSX changes to LSF (without repacking LSV)
  patch <inputDir> [--cleanup]           - Patch all LSX in folder
  patch-value <lsf> <path> <value>      - Patch single value (for API/frontend)
  get-value <lsf> <path>                - Read value at path (for API/frontend)
  get-value <lsf> --list                - List all paths from .offsets.json
  convert <input.lsf> [output.lsx]       - LSF to LSX
  convert <input.lsf> --offsets-only     - Create .offsets.json only (fast, for get-value/patch-value)
  convert <input.lsx> [output.lsf]      - LSX to LSF

Beispiele:
  node dist/cli.js unpack Kiss.lsv ./extracted
  node dist/cli.js extract-lsx Kiss.lsv ./lsx-only
  node dist/cli.js pack-lsx ./lsx-only Kiss_repacked.lsv
  node dist/cli.js pack ./extracted Kiss_repacked.lsv
  node dist/cli.js patch ./extracted/meta.lsx --cleanup
  node dist/cli.js patch ./extracted --cleanup
  node dist/cli.js patch-value meta.lsf MetaData/MetaData/Difficulty 2
  node dist/cli.js get-value meta.lsf MetaData/MetaData/Difficulty
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
			console.error(`Error: File not found: ${inputPath}`);
			process.exit(1);
		}
		mkdirSync(outputDir, { recursive: true });
		console.log(`Extracting ${inputPath} to ${outputDir}...`);
		const extracted = unpackLsv(inputPath, outputDir);
		console.log(`Done: ${extracted.length} files extracted`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "extract-lsx") {
		const outputDir = outputPath ?? join(process.cwd(), "extracted-lsx");
		if (!existsSync(inputPath)) {
			console.error(`Error: File not found: ${inputPath}`);
			process.exit(1);
		}
		mkdirSync(outputDir, { recursive: true });
		console.log(`Extracting ${inputPath} → LSX to ${outputDir}...`);
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

		console.log(`Done: ${extracted.length} files created`);
		extracted.forEach((f) => console.log(`  - ${f}`));
	} else if (command === "pack-lsx") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Error: Directory not found: ${inputPath}`);
			process.exit(1);
		}
		const cleanup = args.includes("--cleanup");
		console.log(`Packing LSX folder ${inputPath} → ${output}...`);
		packLsvFromLsx(inputPath, output, { version: 13 });
		console.log(`Done: ${output} created`);
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
				console.log(`Cleaned up: ${deleted.length} files deleted`);
				deleted.forEach((f) => console.log(`  - ${f}`));
			}
		}
	} else if (command === "pack") {
		const output = outputPath ?? join(process.cwd(), "repacked.lsv");
		if (!existsSync(inputPath)) {
			console.error(`Error: Directory not found: ${inputPath}`);
			process.exit(1);
		}
		console.log(`Packing ${inputPath} → ${output}...`);
		packLsv(inputPath, output, { version: 13 });
		console.log(`Done: ${output} created`);
	} else if (command === "convert") {
		if (!existsSync(inputPath)) {
			console.error(`Error: File not found: ${inputPath}`);
			process.exit(1);
		}
		const isLsf = inputPath.toLowerCase().endsWith(".lsf");
		const offsetsOnly = args.includes("--offsets-only");
		const output = outputPath ?? (isLsf ? inputPath.replace(/\.lsf$/i, ".lsx") : inputPath.replace(/\.lsx$/i, ".lsf"));
		const offsetsPath = (offsetsOnly ? inputPath.replace(/\.lsf$/i, ".lsx") : output) + ".offsets.json";

		if (isLsf) {
			const content = readFileSync(inputPath);
			const reader = new LSFReader(content);
			const root = reader.read();
			const offsetMap = reader.getAttributeOffsetMap();
			const offsetsJson: Record<string, { offset: number; length: number; type: number }> = {};
			for (const [path, info] of offsetMap) {
				offsetsJson[path] = { offset: info.offset, length: info.length, type: info.type };
			}
			if (offsetsOnly) {
				console.log(`Creating ${offsetsPath}...`);
				writeFileSync(offsetsPath, JSON.stringify({ attributes: offsetsJson }, null, 0), "utf8");
				console.log(`Done: ${offsetsPath} (${Object.keys(offsetsJson).length} attributes)`);
			} else {
				console.log(`Converting ${inputPath} → ${output}...`);
				const lsx = convertLsfToLsx(root, reader.getEngineVersion());
				writeFileSync(output, lsx, "utf8");
				writeFileSync(offsetsPath, JSON.stringify({ attributes: offsetsJson }, null, 0), "utf8");
				console.log(`Done: ${output} + ${offsetsPath}`);
			}
		} else {
			const { root, version } = parseLsx(inputPath);
			const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
			writeLsf(root, output, version, opts);
			console.log(`Done: ${output} created`);
		}
	} else if (command === "patch") {
		const cleanup = args.includes("--cleanup");
		if (!existsSync(inputPath)) {
			console.error(`Error: Not found: ${inputPath}`);
			process.exit(1);
		}
		const doPatch = (lsxPath: string): { lsxPath: string; offsetsPath: string; baseLsfPath: string } => {
			const offsetsPath = lsxPath + ".offsets.json";
			const baseLsfPath = lsxPath + ".base.lsf";
			const lsfPath = lsxPath.replace(/\.lsx$/i, ".lsf");
			const basePath = existsSync(baseLsfPath) ? baseLsfPath : (existsSync(lsfPath) ? lsfPath : null);
			if (!existsSync(offsetsPath) || !basePath) {
				console.error(`Error: ${lsxPath} requires .offsets.json and .lsf/.base.lsf`);
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
			console.log(`Patching ${inputPath} → LSF...`);
			const { lsxPath, offsetsPath, baseLsfPath } = doPatch(inputPath);
			if (cleanup) {
				toDelete.push(lsxPath, offsetsPath);
				if (existsSync(baseLsfPath)) toDelete.push(baseLsfPath);
			}
		} else {
			console.log(`Patching LSX files in ${inputPath}...`);
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
				console.log(`  Deleted: ${p}`);
			}
		}
		console.log("Done");
	} else if (command === "patch-value") {
		const lsfPath = inputPath;
		const pathArg = outputPath ?? args[2];
		const valueArg = args[3];
		if (!pathArg || valueArg === undefined) {
			console.error("Usage: patch-value <lsf> <path> <value> [--offsets <file>] [--output <file>]");
			console.error("  path: Attribute path from .offsets.json (e.g. MetaData/MetaData/Difficulty)");
			process.exit(1);
		}
		const offsetsIdx = args.indexOf("--offsets");
		const offsetsPath =
			offsetsIdx >= 0 && args[offsetsIdx + 1]
				? args[offsetsIdx + 1]
				: lsfPath.replace(/\.lsf$/i, ".lsx") + ".offsets.json";
		const outIdx = args.indexOf("--output");
		const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : lsfPath;

		if (!existsSync(lsfPath)) {
			console.error(`Error: LSF not found: ${lsfPath}`);
			process.exit(1);
		}
		if (!existsSync(offsetsPath)) {
			console.error(`Error: Offsets not found: ${offsetsPath}`);
			console.error("  Run 'convert meta.lsf meta.lsx' or 'convert meta.lsf --offsets-only' first.");
			process.exit(1);
		}

		const baseLsf = readFileSync(lsfPath);
		const offsetMap = JSON.parse(readFileSync(offsetsPath, "utf8")) as {
			attributes: Record<string, { offset: number; length: number; type: number }>;
		};
		const value = /^(true|false|1|0)$/i.test(valueArg) ? valueArg.toLowerCase() === "true" || valueArg === "1" : !Number.isNaN(Number(valueArg)) ? Number(valueArg) : valueArg;
		const patched = patchLsfValue(baseLsf, offsetMap, pathArg, value);
		writeFileSync(outPath, patched);
		console.log(`${pathArg} = ${valueArg} → ${outPath}`);
	} else if (command === "get-value") {
		const lsfPath = inputPath;
		const listPaths = args.includes("--list");
		const pathArg = outputPath ?? args[2];
		if (!pathArg && !listPaths) {
			console.error("Verwendung: get-value <lsf> <path> [--offsets <file>]");
			console.error("           get-value <lsf> --list  (list all paths from .offsets.json)");
			process.exit(1);
		}
		const offsetsIdx = args.indexOf("--offsets");
		const offsetsPath =
			offsetsIdx >= 0 && args[offsetsIdx + 1]
				? args[offsetsIdx + 1]
				: lsfPath.replace(/\.lsf$/i, ".lsx") + ".offsets.json";

		if (!existsSync(lsfPath)) {
			console.error(`Error: LSF not found: ${lsfPath}`);
			process.exit(1);
		}
		if (!existsSync(offsetsPath)) {
			console.error(`Error: Offsets not found: ${offsetsPath}`);
			console.error("  Run 'convert meta.lsf meta.lsx' or 'convert meta.lsf --offsets-only' first.");
			process.exit(1);
		}

		const offsetMap = JSON.parse(readFileSync(offsetsPath, "utf8")) as {
			attributes: Record<string, { offset: number; length: number; type: number }>;
		};
		if (listPaths) {
			for (const p of Object.keys(offsetMap.attributes).sort()) {
				console.log(p);
			}
			process.exit(0);
		}
		const lsf = readFileSync(lsfPath);
		const value = getLsfValue(lsf, offsetMap, pathArg);
		console.log(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
	} else {
		console.error(`Unbekannter Befehl: ${command}`);
		process.exit(1);
	}
} catch (err) {
	console.error("Error:", err instanceof Error ? err.message : err);
	process.exit(1);
}
