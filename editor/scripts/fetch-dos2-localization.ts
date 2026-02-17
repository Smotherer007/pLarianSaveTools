/**
 * Lädt die DOS2-Englisch-Lokalisierung herunter und erstellt eine Stats→DisplayName-Mapping-Datei.
 *
 * Quelle: DevilDarkSider/divinity_orginal_sin_2_ua_traslation (English-Basis)
 * Die Lokalisierung enthält contentuid (Handle) → Text.
 *
 * Für Stats→Handle benötigen wir die Spiel-Definitionen (Data/Public/Shared/Stats).
 * Ohne diese wird eine minimale manuelle Mapping-Datei verwendet.
 *
 * Nutzung: npx tsx editor/scripts/fetch-dos2-localization.ts
 */

const LOCALIZATION_URL =
	"https://raw.githubusercontent.com/DevilDarkSider/divinity_orginal_sin_2_ua_traslation/main/Eng%20Loc/Localization/English/english.xml";

const OUTPUT_ITEMS = "editor/public/dos2-items.json";

/**
 * Stats→Handle oder Stats→DisplayName.
 * Handle = "h..." (wird in Lokalisierung nachgeschlagen), sonst direkter Anzeigename.
 */
const STATS_TO_HANDLE_OR_NAME: Record<string, string> = {
	// Potions (Handle aus english.xml)
	POTION_Minor_Healing_Potion: "h703828afg6d07g4605gae23g404c7117e973",
	POTION_Healing_Potion: "h1598c97eg6bc1g4138g8c49gaecb01ceb15d",
	POTION_Large_Healing_Potion: "h24e9d9f2g7e6eg4b9fg9037g196f424ab5e7",
	POTION_Huge_Healing_Potion: "h4042f5d9g1434g4450ga085g9b592d44b1aa",
	POTION_Giant_Healing_Potion: "hc4416c39gec9dg4ce2gaf6ag84b8675c9e33",
	// Gold (direkter Name)
	Small_Gold_Big: "Gold",
	InBetween_Gold: "Gold",
	InBetween_Gold_Big: "Gold",
	Trader_Small_Gold: "Gold",
	Trader_Medium_Gold: "Gold",
	OnlyGold: "Gold",
	// Food & Drinks
	FOOD_Apple: "Apple",
	FOOD_Pear: "Pear",
	CON_Food_Tomato_A: "Tomato",
	CON_Food_Meat_Giblets_A: "Raw Meat",
	CON_Food_Dinner_A: "Dinner",
	CON_Drink_Mug_Beer_A: "Beer",
	CON_Drink_Bottle_Wine_A: "Wine Bottle",
	CON_Drink_Bottle_Beer_A: "Beer Bottle",
	// Scrolls & Grenades
	SCROLL_Resurrect: "Resurrection Scroll",
	GRN_Grenade_Molotov_A: "Molotov Cocktail",
	WPN_Arrow_Poison_A: "Poison Arrow",
	WPN_Arrow_A: "Arrow",
	WPN_ArrowShaft_A: "Arrow Shaft",
	// Sonstiges
	Gen_Paper: "Paper",
	ITEM_Nails: "Nails",
	ITEM_EmptyCupGold: "Empty Gold Cup",
	LOOT_Essence_Life_A: "Life Essence",
};

async function fetchLocalization(): Promise<Map<string, string>> {
	console.log("Lade Lokalisierung von", LOCALIZATION_URL, "...");
	const res = await fetch(LOCALIZATION_URL);
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	const xml = await res.text();

	const handleToText = new Map<string, string>();
	const contentRegex = /<content contentuid="(h[a-f0-9g]+)"[^>]*>([^<]*)<\/content>/g;
	let m: RegExpExecArray | null;
	while ((m = contentRegex.exec(xml)) !== null) {
		const handle = m[1];
		let text = m[2]
			.replace(/&apos;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&");
		// Nur erste Übersetzung behalten wenn mehrfach
		if (!handleToText.has(handle)) {
			handleToText.set(handle, text);
		}
	}

	console.log(`  → ${handleToText.size} Einträge (Handle → Text)`);
	return handleToText;
}

function buildStatsToName(handleToText: Map<string, string>): Record<string, string> {
	const statsToName: Record<string, string> = {};

	for (const [stats, handleOrName] of Object.entries(STATS_TO_HANDLE_OR_NAME)) {
		if (handleOrName.startsWith("h")) {
			const text = handleToText.get(handleOrName);
			statsToName[stats] = text ?? stats.replace(/_/g, " ");
		} else {
			statsToName[stats] = handleOrName;
		}
	}

	return statsToName;
}

async function main() {
	const fs = await import("fs");
	const path = await import("path");

	const handleToText = await fetchLocalization();
	const statsToName = buildStatsToName(handleToText);

	const itemsPath = path.join(process.cwd(), OUTPUT_ITEMS);
	let items: Record<string, { name: string; description: string }> = {};
	if (fs.existsSync(itemsPath)) {
		items = JSON.parse(fs.readFileSync(itemsPath, "utf-8"));
	}
	for (const [stats, name] of Object.entries(statsToName)) {
		items[stats] = { name, description: items[stats]?.description ?? "Item from Divinity Original Sin 2." };
	}

	const outDir = path.dirname(OUTPUT_ITEMS);
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}
	fs.writeFileSync(itemsPath, JSON.stringify(items, null, 2));
	console.log("  →", OUTPUT_ITEMS, `(${Object.keys(items).length} Einträge)`);
	console.log("\nFertig. Der Editor lädt dos2-items.json.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
