/**
 * Reichert dos2-items.json mit Beschreibungen von Fextralife & Crafting Divinity an.
 *
 * Nutzung: npx tsx editor/scripts/merge-stats-to-items.ts
 */

import * as fs from "fs";
import * as path from "path";

const ITEMS_JSON = "editor/public/dos2-items.json";
const CRAFTING_DIVINITY_URL = "https://craftingdivinity.azurewebsites.net/Item/Index";
const FEXTRALIFE_BASE = "https://divinityoriginalsin2.wiki.fextralife.com";

type ItemEntry = { name: string; description: string };

/** Generische Beschreibungen, die ersetzt werden sollen */
const GENERIC_DESCRIPTIONS = [
	"Item from Divinity Original Sin 2.",
	"Crafting material or consumable from Divinity Original Sin 2.",
	"",
];

/** Prüft ob Beschreibung HTML/Junk enthält */
function isInvalidDescription(desc: string): boolean {
	return !desc || desc.includes("<") || desc.includes(">") || desc.length > 500;
}

function isGenericOrEmpty(desc: string): boolean {
	return isInvalidDescription(desc) || GENERIC_DESCRIPTIONS.some((g) => desc === g || desc.startsWith("Item from Divinity"));
}

/** Fextralife: Name → URL-Slug (Leerzeichen → +) */
function toFextralifeSlug(name: string): string {
	return encodeURIComponent(name.replace(/\s+/g, " ").trim()).replace(/%20/g, "+");
}

/** Crafting Divinity Index parsen: Name → Effect */
async function fetchCraftingDivinityMap(): Promise<Record<string, string>> {
	const map: Record<string, string> = {};
	try {
		const res = await fetch(CRAFTING_DIVINITY_URL);
		if (!res.ok) return map;
		const html = await res.text();
		// Format: <tr data-item="Name" data-effect="..."> oder <a href=".../ID/Slug">Name</a></td><td>effect</td>
		const rows1 = html.match(/<tr[^>]+data-item="([^"]+)"[^>]*data-effect="([^"]*)"/g);
		if (rows1) {
			for (const row of rows1) {
				const m = row.match(/data-item="([^"]+)"[^>]*data-effect="([^"]*)"/);
				if (m) {
					const name = (m[1] || "").replace(/&#39;/g, "'").trim();
					const effect = (m[2] || "").replace(/&#39;/g, "'").trim();
					if (name && effect) map[name] = effect;
				}
			}
		}
		// Fallback: Zeilen mit Link + nächstem td (Effect)
		if (Object.keys(map).length < 100) {
			const regex = /<a\s+href="\/Item\/ItemById\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
			let m;
			while ((m = regex.exec(html)) !== null) {
				const name = (m[1] || "").replace(/&#39;/g, "'").trim();
				const effect = (m[2] || "").replace(/&#39;/g, "'").trim();
				if (name && effect) map[name] = effect;
			}
		}
	} catch (e) {
		console.warn("  Crafting Divinity fetch fehlgeschlagen:", (e as Error).message);
	}
	return map;
}

/** Crafting Divinity Detailseite für Effect */
async function fetchCraftingDivinityEffect(id: number, slug: string): Promise<string> {
	try {
		const url = `https://craftingdivinity.azurewebsites.net/Item/ItemById/${id}/${encodeURIComponent(slug)}`;
		const res = await fetch(url);
		if (!res.ok) return "";
		const html = await res.text();
		const m = html.match(/<td>\s*<strong>Effect<\/strong>\s*<\/td>\s*<td>([^<]*)<\/td>/i);
		return m ? (m[1] || "").replace(/&#39;/g, "'").trim() : "";
	} catch {
		return "";
	}
}

/** Fextralife: Beschreibung von Item-Seite extrahieren */
async function fetchFextralifeDescription(name: string): Promise<string> {
	try {
		const slug = toFextralifeSlug(name);
		const url = `${FEXTRALIFE_BASE}/${slug}`;
		const res = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0 (compatible; DOS2-SaveEditor/1.0)" },
		});
		if (!res.ok) return "";
		const html = await res.text();
		// Zitat in Anführungszeichen: "A potion that restores your vitality..." (kein HTML)
		const quoteMatch = html.match(/"([^"<>]{25,300})"/);
		if (quoteMatch && !quoteMatch[1].includes("http")) return quoteMatch[1].trim();
		// Info: "X is a ... that ..."
		const infoMatch = html.match(/\w[\w\s]+\s+is\s+(?:a|an)\s+[\w\s]+(?:that|which)[^<.]{15,200}\./i);
		if (infoMatch) return infoMatch[0].trim();
		// Effect-Phrase (ohne HTML)
		const effectMatch = html.match(/(?:Heals|Deals|Creates|Set|Restores|Cures|Removes)\s+[^<]{10,150}/i);
		if (effectMatch && !effectMatch[0].includes("<")) return effectMatch[0].trim();
	} catch {
		// ignore
	}
	return "";
}

/** Fallback-Beschreibung aus Kategorie */
function getFallbackDescription(id: string, name: string): string {
	const n = (name || id).toLowerCase();
	if (n.includes("gold") || id.includes("Gold")) return "Currency used for trading.";
	if (n.includes("potion")) return "Consumable potion with various effects.";
	if (n.includes("scroll")) return "One-use scroll that casts a spell.";
	if (n.includes("grenade") || n.includes("balloon") || n.includes("flask")) return "Throwable item that creates surfaces or deals damage.";
	if (n.includes("arrow")) return "Ranged ammunition for bows.";
	if (n.includes("essence")) return "Elemental essence used in crafting runes and other items.";
	if (n.includes("skillbook")) return "Teaches a skill when used. Consumed on use.";
	if (n.includes("rune")) return "Magical rune that can be socketed into equipment.";
	if (n.includes("armour") || n.includes("armor") || n.includes("helmet") || n.includes("boots") || n.includes("gloves") || n.includes("shield")) return "Equipment that provides protection or bonuses.";
	if (n.includes("sword") || n.includes("dagger") || n.includes("axe") || n.includes("staff") || n.includes("bow") || n.includes("wand") || n.includes("mace")) return "Weapon for combat.";
	if (n.includes("food") || n.includes("fish") || n.includes("meat") || n.includes("bread") || n.includes("cheese") || n.includes("apple") || n.includes("egg")) return "Food or drink. Can restore health or grant buffs.";
	if (n.includes("herb") || n.includes("mushroom")) return "Ingredient for potions and food.";
	if (n.includes("bone") || n.includes("skull")) return "Crafting material. Used in necromancy and other recipes.";
	if (n.includes("key") || n.includes("lockpick")) return "Opens locked doors or containers.";
	if (n.includes("backpack") || n.includes("container")) return "Container for storing items.";
	if (n.includes("quest")) return "Quest item.";
	return "Item from Divinity Original Sin 2.";
}

async function main() {
	const itemsPath = path.join(process.cwd(), ITEMS_JSON);

	if (!fs.existsSync(itemsPath)) {
		console.error("Nicht gefunden:", ITEMS_JSON);
		process.exit(1);
	}

	let items: Record<string, ItemEntry> = JSON.parse(fs.readFileSync(itemsPath, "utf-8"));
	console.log("Reichere items.json mit Beschreibungen an");
	console.log(`  items: ${Object.keys(items).length} Einträge`);

	// 1. Crafting Divinity Name→Effect Map laden
	console.log("Lade Crafting Divinity Index...");
	const craftingMap = await fetchCraftingDivinityMap();
	console.log(`  → ${Object.keys(craftingMap).length} Items mit Effekt`);

	// 2. Fehlende/generische Beschreibungen mit Crafting Divinity füllen
	const craftingByLower = Object.fromEntries(
		Object.entries(craftingMap).map(([k, v]) => [k.toLowerCase().trim(), v])
	);
	let filledFromCrafting = 0;
	const toFill = Object.entries(items).filter(([, e]) => isGenericOrEmpty(e.description));
	for (const [id, entry] of toFill) {
		const effect = craftingMap[entry.name] ?? craftingByLower[entry.name.toLowerCase().trim()];
		if (effect) {
			items[id] = { ...entry, description: effect };
			filledFromCrafting++;
		}
	}
	console.log(`  → ${filledFromCrafting}/${toFill.length} Beschreibungen von Crafting Divinity`);

	// 3. Noch fehlende: Fextralife (mit Rate-Limit)
	const needFetch = Object.entries(items).filter(
		([, e]) => isGenericOrEmpty(e.description) && !e.name.match(/^(Gold|Quest|Gen_|FUR_|VUL_|FTJ_|CAS00)/)
	);
	if (needFetch.length > 0) {
		console.log(`\nLade ${Math.min(needFetch.length, 80)} Beschreibungen von Fextralife...`);
		const DELAY_MS = 400;
		for (let i = 0; i < Math.min(needFetch.length, 80); i++) {
			const [id, entry] = needFetch[i];
			const desc = await fetchFextralifeDescription(entry.name);
			if (desc && !isInvalidDescription(desc)) {
				items[id] = { ...entry, description: desc };
			} else {
				items[id] = { ...entry, description: getFallbackDescription(id, entry.name) };
			}
			process.stdout.write(`\r  ${i + 1}/${Math.min(needFetch.length, 80)}`);
			if (i < Math.min(needFetch.length, 80) - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
		}
		console.log("");
	}

	// 4. Restliche mit Fallback
	for (const [id, entry] of Object.entries(items)) {
		if (isGenericOrEmpty(entry.description)) {
			items[id] = { ...entry, description: getFallbackDescription(id, entry.name) };
		}
	}

	// 5. Schreiben
	fs.writeFileSync(itemsPath, JSON.stringify(items, null, 2));
	console.log(`\n→ ${ITEMS_JSON} (${Object.keys(items).length} Einträge)`);
	console.log("Fertig.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
