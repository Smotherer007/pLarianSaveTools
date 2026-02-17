/**
 * Lädt die vollständige DOS2-Item-Liste von Crafting Divinity (594 Items)
 * und erstellt dos2-items.json mit name + description.
 *
 * Quelle: https://craftingdivinity.azurewebsites.net/Item/Index
 *
 * Nutzung: npx tsx editor/scripts/fetch-dos2-items.ts
 */

const CRAFTING_DIVINITY_URL = "https://craftingdivinity.azurewebsites.net/Item/Index";
const OUTPUT_ITEMS = "editor/public/dos2-items.json";

/** Bekannte Stats-ID → Name Mappings aus dem Spiel (Priorität) */
const KNOWN_STATS_IDS: Record<string, string> = {
	POTION_Minor_Healing_Potion: "Minor Healing Potion",
	POTION_Healing_Potion: "Healing Potion",
	POTION_Large_Healing_Potion: "Large Healing Potion",
	POTION_Huge_Healing_Potion: "Huge Healing Potion",
	POTION_Giant_Healing_Potion: "Giant Healing Potion",
	Small_Gold_Big: "Gold",
	InBetween_Gold: "Gold",
	InBetween_Gold_Big: "Gold",
	Trader_Small_Gold: "Gold",
	Trader_Medium_Gold: "Gold",
	OnlyGold: "Gold",
	FOOD_Apple: "Apple",
	FOOD_Pear: "Pear",
	CON_Food_Tomato_A: "Tomato",
	CON_Food_Meat_Giblets_A: "Raw Meat",
	CON_Food_Dinner_A: "Dinner",
	CON_Drink_Mug_Beer_A: "Beer",
	CON_Drink_Bottle_Wine_A: "Wine Bottle",
	CON_Drink_Bottle_Beer_A: "Beer Bottle",
	SCROLL_Resurrect: "Resurrection Scroll",
	GRN_Grenade_Molotov_A: "Molotov Cocktail",
	WPN_Arrow_Poison_A: "Poison Arrow",
	WPN_Arrow_A: "Arrow",
	WPN_ArrowShaft_A: "Arrow Shaft",
	Gen_Paper: "Paper",
	ITEM_Nails: "Nails",
	ITEM_EmptyCupGold: "Empty Gold Cup",
	LOOT_Essence_Life_A: "Life Essence",
};

/** Display-Name → Stats-ID (für bekannte Zuordnungen) */
function nameToStatsId(name: string): string {
	// Zuerst bekannte Mappings prüfen
	const known = Object.entries(KNOWN_STATS_IDS).find(([, n]) => n === name);
	if (known) return known[0];

	const normalized = name.replace(/['']/g, "").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");

	if (name.includes("Potion") && !name.includes("Scroll")) {
		if (name.includes("Healing")) return `POTION_${normalized}`;
		if (name.includes("Armour") || name.includes("Armor")) return `POTION_${normalized}`;
		if (name.includes("Resistance")) return `POTION_${normalized}`;
		if (name.includes("Invisibility")) return "POTION_Invisibility";
		if (name.includes("Constitution")) return "POTION_Constitution";
		if (name.includes("Poison")) return `POTION_${normalized}`;
		return `POTION_${normalized}`;
	}
	if (name.includes("Scroll")) return `SCROLL_${normalized}`;
	if (name.includes("Grenade") || name.includes("Balloon") || name.includes("Flask")) return `GRN_${normalized}`;
	if (name.includes("Arrow") || name.includes("Arrowhead")) return `WPN_${normalized}`;
	if (name.includes("Skillbook")) return `ITEM_Skillbook_${normalized}`;
	if (name.includes("Essence")) return `LOOT_Essence_${normalized}`;
	if (name.includes("Rune")) return `ITEM_Rune_${normalized}`;
	if (name.includes("Fish") || name.includes("Stew") || name.includes("Pie") || name.includes("Bread") || name.includes("Dinner") || name.includes("Cheese") || name.includes("Apple") || name.includes("Pear") || name.includes("Carrot") || name.includes("Potato") || name.includes("Grapes") || name.includes("Ham") || name.includes("Eggs") || name.includes("Garlic")) return `CON_Food_${normalized}`;
	if (name.includes("Beer") || name.includes("Wine") || name.includes("Water") || name.includes("Tea") || name.includes("Lemonade") || name.includes("Juice")) return `CON_Drink_${normalized}`;
	if (name.includes("Mushroom") || name.includes("Root") || name.includes("Drudanae")) return `ITEM_${normalized}`;
	if (name.includes("Bone") || name.includes("Hide") || name.includes("Feather") || name.includes("Claw") || name.includes("Antler") || name.includes("Fang") || name.includes("Eye") || name.includes("Skull")) return `ITEM_${normalized}`;
	if (name.includes("Bottle") || name.includes("Flask") || name.includes("Empty")) return `ITEM_${normalized}`;
	if (name.includes("Shield") || name.includes("Armour") || name.includes("Armor") || name.includes("Helmet") || name.includes("Boots") || name.includes("Gloves")) return `ARM_${normalized}`;
	if (name.includes("Sword") || name.includes("Dagger") || name.includes("Axe") || name.includes("Staff") || name.includes("Bow") || name.includes("Crossbow") || name.includes("Wand")) return `WPN_${normalized}`;

	return `ITEM_${normalized}`;
}

interface CraftingItem {
	id: number;
	slug: string;
	name: string;
	effect: string;
	baseValue: number;
}

async function fetchAllItems(): Promise<CraftingItem[]> {
	const items: CraftingItem[] = [];
	const res = await fetch(CRAFTING_DIVINITY_URL);
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	const html = await res.text();

	// Crafting Divinity: <tr data-item="Name"> ... <a href="/Item/ItemById/ID/Slug"> ... <td>effect</td><td>value</td>
	const rows = html.split(/<tr\s+data-item="/);
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		const nameMatch = row.match(/^([^"]+)"\s+data-effect="([^"]*)"/);
		if (!nameMatch) continue;
		const name = (nameMatch[1] || "").replace(/&#39;/g, "'").trim();
		const dataEffect = (nameMatch[2] || "").trim();

		// Extract ItemById link: href="/Item/ItemById/190/A-Jar-of-Mind-Maggots"
		const linkMatch = row.match(/href="\/Item\/ItemById\/(\d+)\/([^"]+)"/);
		const id = linkMatch ? parseInt(linkMatch[1], 10) : 0;
		const slug = linkMatch ? linkMatch[2] : "";

		// Extract td contents: 3 columns (name link, effect, value)
		const tdMatches = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
		if (!tdMatches || tdMatches.length < 3) continue;
		const effect = (tdMatches[1] || "").replace(/<[^>]+>/g, "").trim() || dataEffect;
		const valueStr = (tdMatches[2] || "").replace(/<[^>]+>/g, "").trim();
		const baseVal = parseInt(valueStr, 10) || 0;

		if (name && !items.some((it) => it.name === name)) {
			items.push({ id, slug, name, effect, baseValue: baseVal });
		}
	}

	return items;
}

const BASE_URL = "https://craftingdivinity.azurewebsites.net";

async function fetchItemEffect(id: number, slug: string): Promise<string> {
	try {
		// Slug kann HTML-Entities enthalten (z.B. &#39; für ')
		const decodedSlug = slug.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
		const url = `${BASE_URL}/Item/ItemById/${id}/${encodeURIComponent(decodedSlug)}`;
		const res = await fetch(url);
		if (!res.ok) return "";
		const html = await res.text();
		// Detail page: <td><strong>Effect</strong></td><td>Heals 10%...</td>
		const effectMatch = html.match(/<td>\s*<strong>Effect<\/strong>\s*<\/td>\s*<td>([^<]*)<\/td>/i);
		if (effectMatch) {
			return (effectMatch[1] || "").replace(/&#39;/g, "'").trim();
		}
		// Alternative: | Effect | Heals 10%... |
		const altMatch = html.match(/\|\s*Effect\s*\|([^|]+)\|/i);
		if (altMatch) return (altMatch[1] || "").trim();
	} catch {
		// ignore
	}
	return "";
}

async function enrichWithEffects(items: CraftingItem[]): Promise<CraftingItem[]> {
	const BATCH_SIZE = 8;
	const DELAY_MS = 150;

	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(
			batch.map(async (item) => {
				if (item.effect) return item;
				if (!item.id || !item.slug) return item;
				const effect = await fetchItemEffect(item.id, item.slug);
				return { ...item, effect };
			})
		);
		for (let j = 0; j < results.length; j++) {
			items[i + j] = results[j];
		}
		if (i + BATCH_SIZE < items.length) {
			process.stdout.write(`\r  Lade Beschreibungen: ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
			await new Promise((r) => setTimeout(r, DELAY_MS));
		}
	}
	return items;
}

/** Fallback-Beschreibungen für Items ohne Effekt auf Crafting Divinity */
function getFallbackDescription(name: string): string {
	const n = name.toLowerCase();
	if (n.includes("essence")) return "Elemental essence used in crafting runes and other items.";
	if (n.includes("bone") || n.includes("skull")) return "Crafting material. Used in necromancy and other recipes.";
	if (n.includes("hide") || n.includes("scale") || n.includes("leather")) return "Crafting material for armor and gear.";
	if (n.includes("feather") || n.includes("claw") || n.includes("fang") || n.includes("antler")) return "Crafting material from creatures.";
	if (n.includes("arrowhead") || n.includes("arrow shaft")) return "Crafting component for arrows.";
	if (n.includes("rune")) return "Magical rune that can be socketed into equipment.";
	if (n.includes("skillbook")) return "Teaches a skill when used. Consumed on use.";
	if (n.includes("key")) return "Opens locked doors or containers.";
	if (n.includes("gold") || n.includes("spoon")) return "Currency used for trading.";
	if (n.includes("bottle") || n.includes("flask") || n.includes("empty")) return "Empty container for crafting potions or grenades.";
	if (n.includes("scroll")) return "One-use scroll that casts a spell.";
	if (n.includes("grenade") || n.includes("balloon")) return "Throwable item that creates surfaces or deals damage.";
	if (n.includes("arrow")) return "Ranged ammunition for bows.";
	if (n.includes("armour") || n.includes("armor") || n.includes("shield") || n.includes("helmet") || n.includes("boots") || n.includes("gloves")) return "Equipment that provides protection or bonuses.";
	if (n.includes("sword") || n.includes("dagger") || n.includes("axe") || n.includes("staff") || n.includes("bow") || n.includes("wand")) return "Weapon for combat.";
	if (n.includes("dye")) return "Used to change the color of equipment.";
	if (n.includes("cloth") || n.includes("scrap")) return "Crafting material for armor and other items.";
	if (n.includes("ore") || n.includes("metal") || n.includes("bar")) return "Metal crafting material.";
	if (n.includes("wood") || n.includes("log")) return "Wood crafting material.";
	if (n.includes("mushroom") || n.includes("root") || n.includes("herb")) return "Ingredient for potions and food.";
	if (n.includes("fish") || n.includes("meat") || n.includes("egg")) return "Food ingredient. Can be cooked for better effects.";
	if (n.includes("flour") || n.includes("dough")) return "Crafting ingredient for food recipes.";
	if (n.includes("any ")) return "Placeholder for any item of this type in crafting.";
	return "Crafting material or consumable from Divinity Original Sin 2.";
}

function buildItemsJson(craftingItems: CraftingItem[]): Record<string, { name: string; description: string }> {
	const result: Record<string, { name: string; description: string }> = {};
	const usedStatsIds = new Set<string>();

	for (const item of craftingItems) {
		let statsId = nameToStatsId(item.name);
		// Kollision: gleiche Stats-ID mehrfach
		if (usedStatsIds.has(statsId)) {
			let suffix = 1;
			while (usedStatsIds.has(`${statsId}_${suffix}`)) suffix++;
			statsId = `${statsId}_${suffix}`;
		}
		usedStatsIds.add(statsId);

		const description = item.effect || getFallbackDescription(item.name);
		result[statsId] = { name: item.name, description };
	}

	// Bekannte Stats-IDs mit höherer Priorität (überschreiben falls vorhanden)
	for (const [statsId, name] of Object.entries(KNOWN_STATS_IDS)) {
		const crafting = craftingItems.find((i) => i.name === name);
		result[statsId] = {
			name,
			description: crafting?.effect || result[statsId]?.description || "Item from Divinity Original Sin 2.",
		};
	}

	return result;
}

async function main() {
	const fs = await import("fs");
	const path = await import("path");

	console.log("Lade Items von Crafting Divinity...");
	let craftingItems: CraftingItem[];

	try {
		craftingItems = await fetchAllItems();
		console.log(`  → ${craftingItems.length} Items gefunden`);
		const missing = craftingItems.filter((i) => !i.effect).length;
		if (missing > 0) {
			console.log(`  → Lade ${missing} fehlende Beschreibungen von Detailseiten...`);
			craftingItems = await enrichWithEffects(craftingItems);
			console.log("\r  → Beschreibungen geladen.          ");
		}
	} catch (e) {
		console.error("Fetch fehlgeschlagen:", e);
		console.log("Verwende Fallback: minimale Liste aus bekanntem Mapping");
		craftingItems = Object.entries(KNOWN_STATS_IDS).map(([, name]) => ({
			id: 0,
			slug: "",
			name,
			effect: "",
			baseValue: 0,
		}));
	}

	const itemsJson = buildItemsJson(craftingItems);
	const outDir = path.dirname(OUTPUT_ITEMS);
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}
	fs.writeFileSync(OUTPUT_ITEMS, JSON.stringify(itemsJson, null, 2));
	console.log("  →", OUTPUT_ITEMS, `(${Object.keys(itemsJson).length} Einträge)`);
	console.log("\nFertig.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
