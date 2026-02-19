/**
 * Globals.lsx Editor – PartyManager, Journal, Waypoints, Story/Timers
 * Globals hat mehrere Regionen (root.name === "save", root.children = Regionen)
 */

import { LSFNode, NodeAttributeType } from "../lsf/types.js";

function findRegion(root: LSFNode, regionName: string): LSFNode | null {
	if (root.name === "save" && root.children) {
		return root.children.find((c) => c.name === regionName) ?? null;
	}
	return null;
}

function findChild(parent: LSFNode, name: string): LSFNode | null {
	return parent.children?.find((c) => c.name === name) ?? null;
}

function setAttr(node: LSFNode, name: string, type: NodeAttributeType, value: string | number | boolean): void {
	const existing = node.attributes[name];
	if (existing) {
		existing.value = value;
	} else {
		node.attributes[name] = { name, type, value };
	}
}

/** PartyManager – PartyExperience */
export function getPartyExperience(root: LSFNode): number | null {
	const pm = findRegion(root, "PartyManager");
	if (!pm) return null;
	const party = pm.children?.find((c) => c.name === "Party");
	if (!party) return null;
	const exp = party.attributes.PartyExperience ?? party.attributes.Experience;
	return exp ? (exp.value as number) : null;
}

export function setPartyExperience(root: LSFNode, value: number): boolean {
	const pm = findRegion(root, "PartyManager");
	if (!pm) return false;
	const party = pm.children?.find((c) => c.name === "Party");
	if (!party) return false;
	setAttr(party, "PartyExperience", NodeAttributeType.Int, Math.max(0, value));
	return true;
}

/** Journal – CurrentGameTime */
export function getCurrentGameTime(root: LSFNode): number | null {
	const journal = findRegion(root, "Journal");
	if (!journal) return null;
	const time = journal.attributes.CurrentGameTime;
	return time ? (time.value as number) : null;
}

/** UnlockedRecipes – Rezepte auslesen (read-only) */
export function getUnlockedRecipes(root: LSFNode): string[] {
	const pm = findRegion(root, "PartyManager");
	if (!pm) return [];
	const recipes = pm.children?.find((c) => c.name === "UnlockedRecipes");
	if (!recipes?.children) return [];
	const result: string[] = [];
	for (const r of recipes.children) {
		const name = r.attributes?.Recipe?.value ?? r.attributes?.Object?.value;
		if (name) result.push(String(name));
	}
	return result;
}

/** RegisteredWaypoints – freigeschaltete Waypoints */
export function getRegisteredWaypoints(root: LSFNode): Array<{ name: string; object?: string }> {
	const rw = findRegion(root, "RegisteredWaypoints");
	if (!rw?.children) return [];
	const result: Array<{ name: string; object?: string }> = [];
	for (const w of rw.children) {
		const name = (w.attributes?.WaypointName?.value ?? w.attributes?.Name?.value) as string;
		const obj = (w.attributes?.WaypointObject?.value ?? w.attributes?.Object?.value) as string | undefined;
		if (name) result.push({ name, object: obj });
	}
	return result;
}

/** Story/Timers – TimeOfDay (Tageszeit). Vorsicht: Story enthält binäre Daten. */
export function getTimeOfDay(root: LSFNode): number | null {
	const story = findRegion(root, "Story");
	if (!story) return null;
	const game = findChild(story, "Game");
	if (!game) return null;
	const timers = findChild(game, "Timers");
	if (!timers) return null;
	const timeOfDay = timers.attributes?.TimeOfDay ?? timers.attributes?.CurrentTime;
	return timeOfDay ? (timeOfDay.value as number) : null;
}

export function setTimeOfDay(root: LSFNode, value: number): boolean {
	const story = findRegion(root, "Story");
	if (!story) return false;
	const game = findChild(story, "Game");
	if (!game) return false;
	const timers = findChild(game, "Timers");
	if (!timers) return false;
	// TimeOfDay typischerweise Float (0–24 oder ähnlich)
	setAttr(timers, "TimeOfDay", NodeAttributeType.Float, Math.max(0, Math.min(24, value)));
	return true;
}
