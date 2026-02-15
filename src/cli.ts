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
const args = process.argv.slice(2);
const command = args[0];
const inputPath = args[1];
const outputPath = args[2];

const HELP = `
DOS2 Savegame Tools - LSV unpacker & LSF↔LSX converter

Usage:
  unpack <input.lsv> [outputDir]       - Extract LSV (LSF files)
  extract-lsx <input.lsv> [outputDir]  - LSV → LSX + PNG etc.
  pack-lsx <inputDir> [output.lsv]    - Pack LSX folder back to LSV
  pack <inputDir> [output.lsv]         - Pack directory (LSF) back to LSV
  pack-lsx ... --cleanup               - Remove LSX after packing
  convert <input.lsf> [output.lsx]    - LSF to LSX
  convert <input.lsx> [output.lsf]    - LSX to LSF

Examples:
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
					} else if (entry.name.endsWith(".lsx")) {
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
		const output = outputPath ?? (isLsf ? inputPath.replace(/\.lsf$/i, ".lsx") : inputPath.replace(/\.lsx$/i, ".lsf"));

		if (isLsf) {
			const content = readFileSync(inputPath);
			const reader = new LSFReader(content);
			const root = reader.read();
			console.log(`Converting ${inputPath} → ${output}...`);
			const lsx = convertLsfToLsx(root, reader.getEngineVersion());
			writeFileSync(output, lsx, "utf8");
			console.log(`Done: ${output}`);
		} else {
			const { root, version } = parseLsx(inputPath);
			const opts = version.major >= 4 ? undefined : { metadataFormat: 0 };
			writeLsf(root, output, version, opts);
			console.log(`Done: ${output} created`);
		}
	} else {
		console.error(`Unknown command: ${command}`);
		process.exit(1);
	}
} catch (err) {
	console.error("Error:", err instanceof Error ? err.message : err);
	process.exit(1);
}
