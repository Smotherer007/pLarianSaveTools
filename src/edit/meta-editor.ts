/**
 * Meta.lsx Editor – Bearbeiten von SaveTime, ClientDatas, Party-Reihenfolge, Mod-Liste
 */

import { LSFNode, LSFAttribute, NodeAttributeType } from "../lsf/types.js";

/** Pfad zum inneren MetaData-Node (MetaData → MetaData) */
function getInnerMeta(root: LSFNode): LSFNode | null {
	const meta = root.children?.find((c) => c.name === "MetaData");
	return meta ?? root.children?.[0] ?? null;
}

/** Findet einen Child-Node by name */
function findChild(parent: LSFNode, name: string): LSFNode | null {
	return parent.children?.find((c) => c.name === name) ?? null;
}

/** Setzt oder erstellt ein Attribut */
function setAttr(node: LSFNode, name: string, type: NodeAttributeType, value: string | number | boolean): void {
	const existing = node.attributes[name];
	if (existing) {
		existing.value = value;
	} else {
		node.attributes[name] = { name, type, value };
	}
}

export interface SaveTimeValues {
	year?: number;
	month?: number;
	day?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

/** SaveTime bearbeiten */
export function editSaveTime(root: LSFNode, values: SaveTimeValues): void {
	const inner = getInnerMeta(root);
	if (!inner) return;
	const saveTime = findChild(inner, "SaveTime");
	if (!saveTime) return;

	if (values.year !== undefined) setAttr(saveTime, "Year", NodeAttributeType.Byte, Math.max(0, Math.min(255, values.year)));
	if (values.month !== undefined) setAttr(saveTime, "Month", NodeAttributeType.Byte, Math.max(1, Math.min(12, values.month)));
	if (values.day !== undefined) setAttr(saveTime, "Day", NodeAttributeType.Byte, Math.max(1, Math.min(31, values.day)));
	if (values.hours !== undefined) setAttr(saveTime, "Hours", NodeAttributeType.Byte, Math.max(0, Math.min(23, values.hours)));
	if (values.minutes !== undefined) setAttr(saveTime, "Minutes", NodeAttributeType.Byte, Math.max(0, Math.min(59, values.minutes)));
	if (values.seconds !== undefined) setAttr(saveTime, "Seconds", NodeAttributeType.Byte, Math.max(0, Math.min(59, values.seconds)));
	if (values.milliseconds !== undefined) setAttr(saveTime, "Milliseconds", NodeAttributeType.UShort, Math.max(0, Math.min(999, values.milliseconds)));
}

export interface ModInfo {
	uuid: string;
	name: string;
	version: number;
	folder: string;
}

/** Mod-Liste auslesen (read-only) */
export function getMods(root: LSFNode): ModInfo[] {
	const inner = getInnerMeta(root);
	if (!inner) return [];
	const moduleSettings = findChild(inner, "ModuleSettings");
	const mods = moduleSettings ? findChild(moduleSettings, "Mods") : null;
	if (!mods?.children) return [];

	const result: ModInfo[] = [];
	for (const mod of mods.children) {
		if (mod.name !== "ModuleShortDesc") continue;
		const uuid = (mod.attributes.UUID?.value as string) ?? "";
		const name = (mod.attributes.Name?.value as string) ?? "";
		const version = (mod.attributes.Version?.value as number) ?? 0;
		const folder = (mod.attributes.Folder?.value as string) ?? "";
		result.push({ uuid, name, version, folder });
	}
	return result;
}

/** Party-Reihenfolge ändern (indices 0-based: [2,0,1,3,4] = 3., 1., 2., 4., 5. Charakter) */
export function reorderParty(root: LSFNode, order: number[]): void {
	const inner = getInnerMeta(root);
	if (!inner) return;
	const partyMeta = findChild(inner, "PartyMetaData");
	if (!partyMeta?.children) return;

	const chars = partyMeta.children.filter((c) => c.name === "CharacterMetaData");
	if (order.length !== chars.length) return;

	const reordered: LSFNode[] = [];
	for (const i of order) {
		if (i >= 0 && i < chars.length) reordered.push(chars[i]);
	}
	if (reordered.length === chars.length) {
		partyMeta.children = reordered;
	}
}

export interface ClientDataValues {
	slot: number;
	gameCameraRotation?: number;
	gameCameraDistance?: number;
	hotbarLocked?: boolean;
}

/** ClientData für einen Slot bearbeiten */
export function editClientData(root: LSFNode, values: ClientDataValues): void {
	const inner = getInnerMeta(root);
	if (!inner) return;
	const clientDatas = findChild(inner, "ClientDatas");
	if (!clientDatas?.children) return;

	const slot = values.slot;
	const clientData = clientDatas.children.find((c) => c.name === "ClientData" && (c.attributes.Slot?.value as number) === slot);
	if (!clientData) return;

	if (values.gameCameraRotation !== undefined) setAttr(clientData, "GameCameraRotation", NodeAttributeType.Float, values.gameCameraRotation);
	if (values.gameCameraDistance !== undefined) setAttr(clientData, "GameCameraDistance", NodeAttributeType.Float, values.gameCameraDistance);
	if (values.hotbarLocked !== undefined) setAttr(clientData, "HotbarLocked", NodeAttributeType.Bool, values.hotbarLocked);
}

/** Alle ClientDatas auslesen */
export function getClientDatas(root: LSFNode): Array<{ slot: number; rotation: number; distance: number; hotbarLocked: boolean }> {
	const inner = getInnerMeta(root);
	if (!inner) return [];
	const clientDatas = findChild(inner, "ClientDatas");
	if (!clientDatas?.children) return [];

	const result: Array<{ slot: number; rotation: number; distance: number; hotbarLocked: boolean }> = [];
	for (const c of clientDatas.children) {
		if (c.name !== "ClientData") continue;
		const slot = (c.attributes.Slot?.value as number) ?? 0;
		const rotation = (c.attributes.GameCameraRotation?.value as number) ?? 0;
		const distance = (c.attributes.GameCameraDistance?.value as number) ?? 19;
		const hotbarLocked = (c.attributes.HotbarLocked?.value as boolean) ?? false;
		result.push({ slot, rotation, distance, hotbarLocked });
	}
	return result.sort((a, b) => a.slot - b.slot);
}
