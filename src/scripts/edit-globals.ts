#!/usr/bin/env node
/**
 * Edit globals.lsx – PartyExperience, Waypoints, Recipes, TimeOfDay
 * Usage: node dist/scripts/edit-globals.js <subcommand> <folder> [value]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLsx } from "../lsx/lsx-reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import {
	getPartyExperience,
	setPartyExperience,
	getCurrentGameTime,
	getUnlockedRecipes,
	getRegisteredWaypoints,
	getTimeOfDay,
	setTimeOfDay
} from "../edit/globals-editor.js";

const GLOBALS_PATH = "globals.lsx";

function main(): void {
	const args = process.argv.slice(2);
	const sub = args[0];
	const folder = args[1];
	const valueArg = args[2];
	if (!sub || !folder) {
		console.error("Usage: edit-globals <party-xp|game-time|recipes|waypoints|time-of-day> <folder> [value]");
		process.exit(1);
	}

	const globalsFile = join(folder, GLOBALS_PATH);
	if (!existsSync(globalsFile)) {
		console.error(`Error: ${globalsFile} not found`);
		process.exit(1);
	}

	const xml = readFileSync(globalsFile, "utf8");
	const { root, version } = parseLsx(xml);
	const opts = { lslibMeta: version.lslibMeta ?? "v1,bswap_guids" };
	let modified = false;

	if (sub === "party-xp") {
		if (valueArg !== undefined) {
			const val = parseInt(valueArg, 10);
			if (isNaN(val)) {
				console.error("Value must be a number");
				process.exit(1);
			}
			if (setPartyExperience(root, val)) {
				modified = true;
				console.log(`PartyExperience set to ${val}`);
			} else {
				console.error("Could not set PartyExperience (PartyManager not found)");
				process.exit(1);
			}
		} else {
			const xp = getPartyExperience(root);
			console.log(xp !== null ? `PartyExperience: ${xp}` : "PartyExperience: not found");
		}
	} else if (sub === "game-time") {
		const t = getCurrentGameTime(root);
		console.log(t !== null ? `CurrentGameTime: ${t}` : "CurrentGameTime: not found");
	} else if (sub === "recipes") {
		const recipes = getUnlockedRecipes(root);
		console.log(`UnlockedRecipes: ${recipes.length}`);
		recipes.slice(0, 20).forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
		if (recipes.length > 20) console.log(`  ... and ${recipes.length - 20} more`);
	} else if (sub === "waypoints") {
		const waypoints = getRegisteredWaypoints(root);
		console.log(`RegisteredWaypoints: ${waypoints.length}`);
		waypoints.forEach((w, i) => console.log(`  ${i + 1}. ${w.name}`));
	} else if (sub === "time-of-day") {
		if (valueArg !== undefined) {
			const val = parseFloat(valueArg);
			if (isNaN(val)) {
				console.error("Value must be a number (0–24)");
				process.exit(1);
			}
			if (setTimeOfDay(root, val)) {
				modified = true;
				console.log(`TimeOfDay set to ${val}`);
			} else {
				console.error("Could not set TimeOfDay (Story/Timers not found)");
				process.exit(1);
			}
		} else {
			const t = getTimeOfDay(root);
			console.log(t !== null ? `TimeOfDay: ${t}` : "TimeOfDay: not found");
		}
	} else {
		console.error(`Unknown subcommand: ${sub}`);
		process.exit(1);
	}

	if (modified) {
		const lsx = convertLsfToLsx(root, version, opts);
		writeFileSync(globalsFile, lsx, "utf8");
		console.log(`Updated ${globalsFile}`);
	}
}

main();
