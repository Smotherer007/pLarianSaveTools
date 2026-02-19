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
import {
	editSaveTime,
	getMods,
	reorderParty,
	editClientData,
	getClientDatas,
	type SaveTimeValues,
	type ClientDataValues
} from "./edit/meta-editor.js";
import {
	getPartyExperience,
	setPartyExperience,
	getCurrentGameTime,
	getUnlockedRecipes,
	getRegisteredWaypoints,
	getTimeOfDay,
	setTimeOfDay
} from "./edit/globals-editor.js";
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

  edit savetime <folder> [--year N --month N --day N --hours N --minutes N --seconds N]
  edit mods <folder>                   - Mod-Liste anzeigen
  edit party-order <folder> <order>     - z.B. 3,1,2,4,5
  edit client-data <folder> [--slot N --rotation X --distance Y --hotbar-locked]
  edit party-xp <folder> [value]       - PartyExperience anzeigen/setzen
  edit waypoints <folder>              - Waypoints anzeigen
  edit recipes <folder>                - UnlockedRecipes anzeigen
  edit time-of-day <folder> [value]    - Tageszeit anzeigen/setzen (0–24)
  edit info <folder>                   - Zusammenfassung (meta + globals)

Examples:
  node dist/cli.js extract-lsx Kiss.lsv ./lsx-only
  node dist/cli.js edit savetime ./lsx-only --year 127 --month 3 --day 17
  node dist/cli.js edit mods ./lsx-only
  node dist/cli.js edit party-order ./lsx-only 3,1,2,4,5
  node dist/cli.js pack-lsx ./lsx-only Kiss_repacked.lsv
`;

if (!command || args.includes("--help") || args.includes("-h") || command === "help") {
	console.log(HELP);
	process.exit(command ? 0 : 1);
}

const editSub = args[1];
const editFolder = args[2];
const editRest = args.slice(3);

if (!inputPath && command !== "edit") {
	console.error(HELP);
	process.exit(1);
}

function parseEditFlags(arr: string[]): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (let i = 0; i < arr.length; i++) {
		if (arr[i].startsWith("--")) {
			const key = arr[i].slice(2).replace(/-/g, "");
			const next = arr[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				out[key] = /^\d+\.?\d*$/.test(next) ? parseFloat(next) : next === "true" ? true : next === "false" ? false : next;
				i++;
			} else {
				out[key] = true;
			}
		}
	}
	return out;
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
	} else if (command === "edit") {
		if (!editSub || !editFolder) {
			console.error("Usage: edit <subcommand> <folder> [options]");
			process.exit(1);
		}
		const folder = join(process.cwd(), editFolder);
		if (!existsSync(folder)) {
			console.error(`Error: Folder not found: ${folder}`);
			process.exit(1);
		}
		const metaFile = join(folder, "meta.lsx");
		const globalsFile = join(folder, "globals.lsx");
		const lsxOpts = { lslibMeta: "v1,bswap_guids" };

		if (editSub === "savetime") {
			const flags = parseEditFlags(editRest);
			const values: SaveTimeValues = {};
			if (flags.year !== undefined) values.year = Number(flags.year);
			if (flags.month !== undefined) values.month = Number(flags.month);
			if (flags.day !== undefined) values.day = Number(flags.day);
			if (flags.hours !== undefined) values.hours = Number(flags.hours);
			if (flags.minutes !== undefined) values.minutes = Number(flags.minutes);
			if (flags.seconds !== undefined) values.seconds = Number(flags.seconds);
			if (flags.milliseconds !== undefined) values.milliseconds = Number(flags.milliseconds);
			if (existsSync(metaFile) && Object.keys(values).length > 0) {
				const { root, version } = parseLsx(readFileSync(metaFile, "utf8"));
				editSaveTime(root, values);
				writeFileSync(metaFile, convertLsfToLsx(root, version, lsxOpts), "utf8");
				console.log("SaveTime updated");
			} else if (existsSync(metaFile)) {
				const { root } = parseLsx(readFileSync(metaFile, "utf8"));
				const inner = root.children?.[0];
				const st = inner?.children?.find((c: { name: string }) => c.name === "SaveTime");
				if (st?.attributes) {
					const y = st.attributes.Year?.value ?? "?";
					const m = st.attributes.Month?.value ?? "?";
					const d = st.attributes.Day?.value ?? "?";
					const h = st.attributes.Hours?.value ?? "?";
					const min = st.attributes.Minutes?.value ?? "?";
					const s = st.attributes.Seconds?.value ?? "?";
					console.log(`SaveTime: ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
				}
			}
		} else if (editSub === "mods") {
			if (existsSync(metaFile)) {
				const { root } = parseLsx(readFileSync(metaFile, "utf8"));
				const mods = getMods(root);
				console.log("Mods:");
				mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (${m.folder})`));
			} else {
				console.error("meta.lsx not found");
				process.exit(1);
			}
		} else if (editSub === "party-order") {
			const orderStr = editRest[0];
			if (!orderStr) {
				console.error("Usage: edit party-order <folder> <order>  e.g. 3,1,2,4,5");
				process.exit(1);
			}
			const order = orderStr.split(",").map((s) => parseInt(s.trim(), 10) - 1);
			if (order.some((n) => isNaN(n) || n < 0)) {
				console.error("Order must be comma-separated 1-based indices");
				process.exit(1);
			}
			if (existsSync(metaFile)) {
				const { root, version } = parseLsx(readFileSync(metaFile, "utf8"));
				reorderParty(root, order);
				writeFileSync(metaFile, convertLsfToLsx(root, version, lsxOpts), "utf8");
				console.log("Party order updated");
			} else {
				console.error("meta.lsx not found");
				process.exit(1);
			}
		} else if (editSub === "client-data") {
			const flags = parseEditFlags(editRest);
			const slot = flags.slot ?? flags.s;
			if (existsSync(metaFile)) {
				const { root, version } = parseLsx(readFileSync(metaFile, "utf8"));
				if (slot === undefined) {
					const datas = getClientDatas(root);
					console.log("ClientDatas:");
					datas.forEach((d) => console.log(`  Slot ${d.slot}: rotation=${d.rotation} distance=${d.distance} hotbarLocked=${d.hotbarLocked}`));
				} else {
					const values: ClientDataValues = { slot: Number(slot) };
					if (flags.rotation !== undefined) values.gameCameraRotation = Number(flags.rotation);
					if (flags.distance !== undefined) values.gameCameraDistance = Number(flags.distance);
					if (flags.hotbarlocked !== undefined) values.hotbarLocked = Boolean(flags.hotbarlocked);
					editClientData(root, values);
					writeFileSync(metaFile, convertLsfToLsx(root, version, lsxOpts), "utf8");
					console.log("ClientData updated");
				}
			} else {
				console.error("meta.lsx not found");
				process.exit(1);
			}
		} else if (editSub === "party-xp" || editSub === "waypoints" || editSub === "recipes" || editSub === "time-of-day" || editSub === "game-time") {
			if (!existsSync(globalsFile)) {
				console.error("globals.lsx not found");
				process.exit(1);
			}
			const { root, version } = parseLsx(readFileSync(globalsFile, "utf8"));
			if (editSub === "party-xp") {
				const val = editRest[0];
				if (val !== undefined) {
					const n = parseInt(val, 10);
					if (isNaN(n)) {
						console.error("Value must be a number");
						process.exit(1);
					}
					if (setPartyExperience(root, n)) {
						writeFileSync(globalsFile, convertLsfToLsx(root, version, lsxOpts), "utf8");
						console.log(`PartyExperience set to ${n}`);
					} else {
						console.error("PartyManager/Party not found");
						process.exit(1);
					}
				} else {
					const xp = getPartyExperience(root);
					console.log(xp !== null ? `PartyExperience: ${xp}` : "PartyExperience: not found");
				}
			} else if (editSub === "game-time") {
				const t = getCurrentGameTime(root);
				console.log(t !== null ? `CurrentGameTime: ${t}` : "CurrentGameTime: not found");
			} else if (editSub === "recipes") {
				const recipes = getUnlockedRecipes(root);
				console.log(`UnlockedRecipes: ${recipes.length}`);
				recipes.slice(0, 20).forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
				if (recipes.length > 20) console.log(`  ... and ${recipes.length - 20} more`);
			} else if (editSub === "waypoints") {
				const waypoints = getRegisteredWaypoints(root);
				console.log(`RegisteredWaypoints: ${waypoints.length}`);
				waypoints.forEach((w, i) => console.log(`  ${i + 1}. ${w.name}`));
			} else if (editSub === "time-of-day") {
				const val = editRest[0];
				if (val !== undefined) {
					const n = parseFloat(val);
					if (isNaN(n)) {
						console.error("Value must be a number (0–24)");
						process.exit(1);
					}
					if (setTimeOfDay(root, n)) {
						writeFileSync(globalsFile, convertLsfToLsx(root, version, lsxOpts), "utf8");
						console.log(`TimeOfDay set to ${n}`);
					} else {
						console.error("Story/Timers not found");
						process.exit(1);
					}
				} else {
					const t = getTimeOfDay(root);
					console.log(t !== null ? `TimeOfDay: ${t}` : "TimeOfDay: not found");
				}
			}
		} else if (editSub === "info") {
			if (existsSync(metaFile)) {
				const { root } = parseLsx(readFileSync(metaFile, "utf8"));
				const inner = root.children?.[0];
				const diff = inner?.attributes?.Difficulty?.value;
				const level = inner?.attributes?.Level?.value;
				const saveId = inner?.attributes?.SaveGameID?.value;
				const mods = getMods(root);
				const st = inner?.children?.find((c: { name: string }) => c.name === "SaveTime");
				const stStr = st?.attributes
					? `${st.attributes.Year?.value}-${String(st.attributes.Month?.value).padStart(2, "0")}-${String(st.attributes.Day?.value).padStart(2, "0")} ${String(st.attributes.Hours?.value).padStart(2, "0")}:${String(st.attributes.Minutes?.value).padStart(2, "0")}`
					: "?";
				const chars = inner?.children?.find((c: { name: string }) => c.name === "PartyMetaData")?.children?.filter((c: { name: string }) => c.name === "CharacterMetaData") ?? [];
				console.log("=== meta.lsx ===");
				console.log(`Level: ${level ?? "?"} | SaveGameID: ${saveId ?? "?"} | Difficulty: ${diff ?? "?"}`);
				console.log(`SaveTime: ${stStr}`);
				console.log(`Characters: ${chars.length}`);
				chars.forEach((c: { attributes: Record<string, { value: unknown }> }, i: number) => {
					const v = c.attributes?.CharacterName?.value;
					const name = typeof v === "object" && v !== null && "value" in v ? (v as { value: string }).value : String(v ?? "?");
					console.log(`  ${i + 1}. ${name}`);
				});
				console.log(`Mods: ${mods.length}`);
				mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}`));
			}
			if (existsSync(globalsFile)) {
				const { root } = parseLsx(readFileSync(globalsFile, "utf8"));
				const xp = getPartyExperience(root);
				const gameTime = getCurrentGameTime(root);
				const waypoints = getRegisteredWaypoints(root);
				const recipes = getUnlockedRecipes(root);
				const tod = getTimeOfDay(root);
				console.log("\n=== globals.lsx ===");
				console.log(`PartyExperience: ${xp ?? "?"}`);
				console.log(`CurrentGameTime: ${gameTime ?? "?"}`);
				console.log(`TimeOfDay: ${tod ?? "?"}`);
				console.log(`Waypoints: ${waypoints.length}`);
				console.log(`UnlockedRecipes: ${recipes.length}`);
			} else {
				console.log("\n(globals.lsx not found)");
			}
		} else {
			console.error(`Unknown edit subcommand: ${editSub}`);
			process.exit(1);
		}
	} else {
		console.error(`Unknown command: ${command}`);
		process.exit(1);
	}
} catch (err) {
	console.error("Error:", err instanceof Error ? err.message : err);
	process.exit(1);
}
