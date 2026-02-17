/**
 * Parser für Inventar (Equipment + Bag) aus globals.lsx
 *
 * DOS2-Struktur:
 * - Character hat attribute Inventory (Handle)
 * - region Items: ItemFactory > Creators (Handle) + Items (Item mit Parent, Slot, CurrentTemplate, Stats)
 * - Slot 0-15: Equipment (Helm, Brust, Beine, Handschuhe, Stiefel, Waffe1, Waffe2, Ring1, Ring2, Amulett, Gürtel, …)
 * - Slot >= 16: Tasche
 */

export interface InventoryItem {
	handle: string;
	templateId: string;
	stats: string;
	slot: number;
	level?: number;
	/** Menge (z.B. Gold, Tränke); Standard 1 wenn nicht vorhanden */
	amount: number;
}

export interface CharacterInventory {
	equipment: InventoryItem[];
	bag: InventoryItem[];
}

const EQUIPMENT_SLOT_NAMES: Record<number, string> = {
	0: "Helm",
	1: "Brust",
	2: "Beine",
	3: "Handschuhe",
	4: "Stiefel",
	5: "Waffe 1",
	6: "Waffe 2",
	7: "Ring 1",
	8: "Ring 2",
	9: "Amulett",
	10: "Gürtel",
	11: "Schild",
	12: "Horn",
	13: "Tasche 1",
	14: "Tasche 2",
	15: "Tasche 3",
};

function getAttr(el: Element | null, name: string): string {
	return el?.getAttribute(name) ?? "";
}

function getInt(el: Element | null, name: string): number {
	return parseInt(getAttr(el, name), 10) || 0;
}

/** Handle → Item-Daten aus region Items */
function buildItemMap(doc: Document): Map<string, { templateId: string; stats: string; parent: string; slot: number; level: number; amount: number }> {
	const map = new Map<string, { templateId: string; stats: string; parent: string; slot: number; level: number; amount: number }>();
	const creators = doc.querySelectorAll('region[id="Items"] node[id="Creator"]');
	const items = doc.querySelectorAll('region[id="Items"] node[id="Item"]');
	creators.forEach((creator, i) => {
		const item = items[i];
		if (!item) return;
		const handle = getAttr(creator.querySelector('attribute[id="Handle"]'), "value");
		if (!handle) return;
		const templateId = getAttr(item.querySelector('attribute[id="CurrentTemplate"]'), "value");
		const stats = getAttr(item.querySelector('attribute[id="Stats"]'), "value");
		const parent = getAttr(item.querySelector('attribute[id="Parent"]'), "value");
		const slot = getInt(item.querySelector('attribute[id="Slot"]'), "value");
		const statsNode = item.querySelector('node[id="Stats"]');
		const level = statsNode ? getInt(statsNode.querySelector('attribute[id="Level"]'), "value") : 0;
		const amount = getInt(item.querySelector('attribute[id="Amount"]'), "value") || 1;
		map.set(handle, { templateId, stats, parent, slot, level, amount });
	});
	return map;
}

/** Cache: gleiche globals.xml nur einmal parsen (kann 50MB+ sein) */
let _cachedXml: string | null = null;
let _cachedDoc: Document | null = null;

function getCachedDoc(xml: string): Document {
	if (_cachedXml === xml && _cachedDoc) return _cachedDoc;
	_cachedXml = xml;
	_cachedDoc = new DOMParser().parseFromString(xml, "text/xml");
	return _cachedDoc;
}

/** Inventar für einen Charakter parsen (Equipment + Bag) */
export function parseCharacterInventory(xml: string, inventoryHandle: string): CharacterInventory {
	const doc = getCachedDoc(xml);
	const itemMap = buildItemMap(doc);
	const equipment: InventoryItem[] = [];
	const bag: InventoryItem[] = [];

	itemMap.forEach((data, handle) => {
		if (data.parent !== inventoryHandle) return;
		const item: InventoryItem = { handle, templateId: data.templateId, stats: data.stats, slot: data.slot, level: data.level, amount: data.amount };
		if (data.slot >= 0 && data.slot <= 15) {
			equipment.push(item);
		} else {
			bag.push(item);
		}
	});

	equipment.sort((a, b) => a.slot - b.slot);
	bag.sort((a, b) => a.slot - b.slot);

	return { equipment, bag };
}

/** Prüft ob Item Gold ist (Small_Gold_Big, InBetween_Gold, OnlyGold, etc.) */
export function isGoldItem(item: InventoryItem): boolean {
	return !!(item.stats && (item.stats === "OnlyGold" || item.stats.includes("Gold")));
}

export type ItemEntry = { name: string; description?: string };

/** Anzeigename für Item: itemsData (priorität) > statsToName > Stats-ID */
export function getItemDisplayName(
	item: InventoryItem,
	statsToName?: Record<string, string>,
	itemsData?: Record<string, ItemEntry>
): string {
	if (isGoldItem(item)) return "Gold";
	if (item.stats && !item.stats.startsWith("_")) {
		const fromItems = itemsData?.[item.stats]?.name;
		const fromStats = statsToName?.[item.stats];
		return fromItems ?? fromStats ?? item.stats;
	}
	return item.templateId.slice(0, 12) + "…";
}

/** Anzeigename inkl. Menge */
export function getItemDisplayNameWithAmount(
	item: InventoryItem,
	statsToName?: Record<string, string>,
	itemsData?: Record<string, ItemEntry>
): string {
	const name = getItemDisplayName(item, statsToName, itemsData);
	return item.amount > 1 ? `${name} ×${item.amount}` : name;
}

export { EQUIPMENT_SLOT_NAMES };
