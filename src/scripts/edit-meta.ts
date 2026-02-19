#!/usr/bin/env node
/**
 * Edit meta.lsx – SaveTime, Mods, Party-Reihenfolge, ClientDatas
 * Usage: node dist/scripts/edit-meta.js <subcommand> <folder> [options]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLsx } from "../lsx/lsx-reader.js";
import { convertLsfToLsx } from "../lsx/lsx-writer.js";
import {
	editSaveTime,
	getMods,
	reorderParty,
	editClientData,
	getClientDatas,
	type SaveTimeValues,
	type ClientDataValues
} from "../edit/meta-editor.js";

const META_PATH = "meta.lsx";

function parseArgs(args: string[]): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].slice(2).replace(/-/g, "");
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				out[key] = /^\d+$/.test(next) ? parseInt(next, 10) : next === "true" ? true : next === "false" ? false : next;
				i++;
			} else {
				out[key] = true;
			}
		}
	}
	return out;
}

function main(): void {
	const args = process.argv.slice(2);
	const sub = args[0];
	const folder = args[1];
	if (!sub || !folder) {
		console.error("Usage: edit-meta <savetime|mods|party-order|client-data|client-datas> <folder> [options]");
		process.exit(1);
	}

	const metaFile = join(folder, META_PATH);
	if (!existsSync(metaFile)) {
		console.error(`Error: ${metaFile} not found`);
		process.exit(1);
	}

	const xml = readFileSync(metaFile, "utf8");
	const { root, version } = parseLsx(xml);
	const opts = { lslibMeta: version.lslibMeta ?? "v1,bswap_guids" };
	let modified = false;

	if (sub === "savetime") {
		const flags = parseArgs(args.slice(2));
		const values: SaveTimeValues = {};
		if (flags.year !== undefined) values.year = Number(flags.year);
		if (flags.month !== undefined) values.month = Number(flags.month);
		if (flags.day !== undefined) values.day = Number(flags.day);
		if (flags.hours !== undefined) values.hours = Number(flags.hours);
		if (flags.minutes !== undefined) values.minutes = Number(flags.minutes);
		if (flags.seconds !== undefined) values.seconds = Number(flags.seconds);
		if (flags.milliseconds !== undefined) values.milliseconds = Number(flags.milliseconds);
		if (Object.keys(values).length > 0) {
			editSaveTime(root, values);
			modified = true;
		} else {
			// Anzeigen
			const inner = root.children?.[0];
			const saveTime = inner?.children?.find((c: { name: string }) => c.name === "SaveTime");
			if (saveTime?.attributes) {
				const y = saveTime.attributes.Year?.value ?? "?";
				const m = saveTime.attributes.Month?.value ?? "?";
				const d = saveTime.attributes.Day?.value ?? "?";
				const h = saveTime.attributes.Hours?.value ?? "?";
				const min = saveTime.attributes.Minutes?.value ?? "?";
				const s = saveTime.attributes.Seconds?.value ?? "?";
				console.log(`SaveTime: ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
			}
		}
	} else if (sub === "mods") {
		const mods = getMods(root);
		console.log("Mods:");
		mods.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (${m.folder})`));
	} else if (sub === "party-order") {
		const orderStr = args[2];
		if (!orderStr) {
			console.error("Usage: edit-meta party-order <folder> <order>  e.g. 3,1,2,4,5");
			process.exit(1);
		}
		const order = orderStr.split(",").map((s) => parseInt(s.trim(), 10) - 1);
		if (order.some((n) => isNaN(n) || n < 0)) {
			console.error("Order must be comma-separated 1-based indices, e.g. 3,1,2,4,5");
			process.exit(1);
		}
		reorderParty(root, order);
		modified = true;
	} else if (sub === "client-data") {
		const flags = parseArgs(args.slice(2));
		const slot = flags.slot ?? flags.s;
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
			modified = true;
		}
	} else if (sub === "client-datas") {
		const datas = getClientDatas(root);
		console.log("ClientDatas:");
		datas.forEach((d) => console.log(`  Slot ${d.slot}: rotation=${d.rotation} distance=${d.distance} hotbarLocked=${d.hotbarLocked}`));
	} else {
		console.error(`Unknown subcommand: ${sub}`);
		process.exit(1);
	}

	if (modified) {
		const lsx = convertLsfToLsx(root, version, opts);
		writeFileSync(metaFile, lsx, "utf8");
		console.log(`Updated ${metaFile}`);
	}
}

main();
