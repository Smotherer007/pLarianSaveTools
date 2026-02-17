/**
 * Extrahiert alle Stats-IDs aus den Save-Sessions und merged sie in
 * dos2-stats-to-name.json und dos2-items.json.
 *
 * Nutzung: npx tsx editor/scripts/extract-stats-from-saves.ts
 */

import * as fs from "fs";
import * as path from "path";

const SESSIONS_DIR = path.join(process.cwd(), "editor/sessions");
const EXAMPLE_DIR = path.join(process.cwd(), "Example");
const ITEMS_JSON = "editor/public/dos2-items.json";

/** Stats-ID → lesbarer Name (aus ID abgeleitet wenn unbekannt) */
function idToDisplayName(id: string): string {
	// Gold-Varianten
	if (id.includes("Gold")) return "Gold";

	// Bekannte Muster
	const m: Record<string, string> = {
		CONT_Backpack_A_SourceHunter: "Source Hunter Backpack",
		CONT_Backpack_Junk: "Junk Backpack",
		CONT_Backpack_A: "Backpack",
		CON_Food_Meat_Cow_A: "Raw Meat",
		CON_Food_Meat_Giblets_A: "Raw Meat",
		CON_Food_Meat_BirdLeg_A: "Bird Leg",
		CON_Food_Meat_Mutton_A: "Mutton",
		CON_Food_Meat_RabbitMeat_A: "Rabbit Meat",
		CON_Food_Meat_Raw_A: "Raw Meat",
		CON_Food_Meat_Ribs_A: "Ribs",
		CON_Food_Eggs_A: "Eggs",
		CON_Food_Bread_Cheese_A: "Cheese Bread",
		CON_Food_Soup_Pumpkin_A: "Pumpkin Soup",
		CON_Food_Dinner_A: "Dinner",
		CON_Food_Potato_A: "Potato",
		CON_Food_Potato_Mash_A: "Mashed Potato",
		CON_Food_Tomato_A: "Tomato",
		CON_Food_Onion_A: "Onion",
		CON_Food_Garlic: "Garlic",
		CON_Food_WaterMelon: "Watermelon",
		CON_Food_SalmonPie_A: "Salmon Pie",
		CON_Food_Pie_Cyseal_A_Poisoned: "Poisoned Pie",
		CON_Drink_Bottle_Beer_A: "Beer Bottle",
		CON_Drink_Bottle_Beer_A_Poisoned: "Poisoned Beer",
		CON_Drink_Bottle_Water_A: "Water Bottle",
		CON_Drink_Bottle_Wine_A: "Wine Bottle",
		CON_Drink_Mug_Beer_A: "Beer",
		CON_Drink_Mug_Water_A: "Water",
		CON_Drink_Mug_Wine_A: "Wine",
		CON_Drink_Cup_A_Empty: "Empty Cup",
		CON_Drink_Cup_A_Lemonade: "Lemonade",
		CON_Drink_Cup_A_Milk: "Milk",
		CON_Drink_Cup_A_Orange: "Orange Juice",
		CON_Drink_Cup_A_Tea: "Tea",
		CON_Drink_Cup_A_Water: "Water",
		CON_Potion_Empty_A: "Empty Potion Bottle",
		CON_Potion_MagicArmor_Boost_A: "Magic Armor Potion",
		CON_Potion_Invisible_A: "Invisibility Potion",
		CON_Potion_Poison_A: "Poison Potion",
		CON_Potion_Fire_Res_Large_A: "Fire Resistance Potion",
		CON_Herb_Whisperwood_A: "Whisperwood",
		CON_Herb_Drudanae: "Drudanae",
		CON_Herb_Drudanae_Griff: "Griff's Drudanae",
		CON_Herb_Augmentor_A: "Augmentor",
		CON_Herb_Mushroom_A: "Mushroom",
		CON_Herb_Mushroom_C: "Mushroom",
		CON_Herb_YarrowFlower: "Yarrow Flower",
		CON_Nature_Mushroom_Amadouvier_A: "Amadouvier",
		FOOD_Apple: "Apple",
		FOOD_Pear: "Pear",
		FOOD_Orange: "Orange",
		FOOD_Orange_Fake: "Fake Orange",
		FOOD_Bread: "Bread",
		FOOD_Cheese: "Cheese",
		FOOD_Ham: "Ham",
		FOOD_FishA: "Fish",
		FOOD_FishB: "Fish",
		FOOD_FishC: "Fish",
		SCROLL_Resurrect: "Resurrection Scroll",
		SCROLL_RegenerateStart: "Regenerate Scroll",
		SCROLL_Fortify: "Fortify Scroll",
		SCROLL_Fireball: "Fireball Scroll",
		SCROLL_LighningBolt: "Lightning Bolt Scroll",
		SCROLL_Haste: "Haste Scroll",
		SCROLL_Shout_BlindingRadiance: "Blinding Radiance Scroll",
		SCROLL_Target_BurnMyEyes: "Burn My Eyes Scroll",
		SCROLL_Target_DecayingTouch: "Decaying Touch Scroll",
		SCROLL_Target_FrostyShell: "Frosty Shell Scroll",
		GRN_Grenade_Molotov_A: "Molotov Cocktail",
		GRN_Grenade_PoisonFlask_A: "Poison Flask",
		GRN_Grenade_WaterBalloon_A: "Water Balloon",
		GRN_Grenade_Ice_A: "Frost Grenade",
		GRN_Grenade_Flashbang_A: "Flashbang",
		GRN_Grenade_SmokeBomb_A: "Smoke Bomb",
		GRN_Grenade_Taser_A: "Taser Grenade",
		GRN_Grenade_OilFlask_A: "Oil Flask",
		GRN_Grenade_ClusterBomb_A: "Cluster Grenade",
		GRN_Grenade_Nailbomb_A: "Nailbomb",
		GRN_Grenade_ArmorPiercing_A: "Armor Piercing Grenade",
		GRN_Ingredient_Flask_Empty_A: "Empty Flask",
		TOOL_Lockpick: "Lockpick",
		TOOL_RepairHammer: "Repair Hammer",
		TOOL_Shovel_A: "Shovel",
		TOOL_FishingRod_A: "Fishing Rod",
		TOOL_IdentifyingGlass: "Identifying Glass",
		TOOL_Intestines_A: "Intestines",
		TOOL_Shears_A: "Shears",
		TOOL_Tong_A: "Tongs",
		TOOL_Trap_DisarmToolkit: "Disarm Toolkit",
		TOOL_Figurine_Wood_A: "Wooden Figurine",
		WPN_Dagger: "Dagger",
		WPN_Arrow_A: "Arrow",
		WPN_Arrow_Poison_A: "Poison Arrow",
		WPN_Arrow_Fire_A: "Fire Arrow",
		WPN_Arrow_Freezing_A: "Freezing Arrow",
		WPN_Arrow_Water_A: "Water Arrow",
		WPN_ArrowShaft_A: "Arrow Shaft",
		WPN_ArrowHead_A: "Arrowhead",
		WPN_ArrowHead_Poison_A: "Poison Arrowhead",
		Gen_Paper: "Paper",
		Gen_Book: "Book",
		Gen_Letter: "Letter",
		ITEM_Nails: "Nails",
		ITEM_Key: "Key",
		ITEM_Soap: "Soap",
		ITEM_EmptyCupGold: "Empty Gold Cup",
		ITEM_EmptyBottle: "Empty Bottle",
		ITEM_BrokenBottle: "Broken Bottle",
		LOOT_Essence_Life_A: "Life Essence",
		LOOT_Essence_Earth_A: "Earth Essence",
		LOOT_Essence_Water_A: "Water Essence",
		LOOT_Essence_Fire_A: "Fire Essence",
		LOOT_Scraps_Leather_A: "Leather Scraps",
		LOOT_Scraps_Cloth_A: "Cloth Scraps",
		LOOT_Scraps_Wood_A: "Wood Scraps",
		LOOT_WoodenBranch_A: "Wooden Branch",
		LOOT_WoodenStick_A: "Wooden Stick",
		LOOT_PieceOfRock_A: "Piece of Rock",
		LOOT_Claw_Crab_A: "Crab Claw",
		LOOT_Thread_A: "Thread",
		LOOT_Needle_A: "Needle",
		LOOT_Rope_A: "Rope",
		LOOT_String_Bow_A: "Bowstring",
		LOOT_Tooth_A: "Tooth",
		LOOT_Skull_Human_A: "Human Skull",
		LOOT_Skull_Bird_A: "Bird Skull",
		LOOT_Source_Orb: "Source Orb",
		LOOT_Soul_Tormented_A: "Tormented Soul",
		LOOT_Wheat_A: "Wheat",
		LOOT_Ink_Pot_A: "Ink Pot",
		LOOT_MetalShard_A: "Metal Shard",
		LOOT_Gems_Diamond_B: "Diamond",
		LOOT_Gems_Malachite: "Malachite",
		LOOT_Ruby_A: "Ruby",
		LOOT_Rune_Frost_Medium: "Frost Rune",
		LOOT_Paw_A_Rabbit_A: "Rabbit Paw",
		LOOT_Tail_A_Rat_A: "Rat Tail",
		LOOT_Panties_A: "Panties",
		LOOT_Toy_Ball_Red_A: "Red Ball",
		LOOT_Toy_WoodenBlocks_B: "Wooden Blocks",
		FUR_Humans_Camping_Sleepingbag_B: "Sleeping Bag",
		ARM_SourceCollar_Broken: "Broken Source Collar",
		ARM_SourceCollar: "Source Collar",
		ARM_ShapeshifterMask: "Shapeshifter Mask",
		POTION_Minor_Healing_Potion: "Minor Healing Potion",
		POTION_Medium_Healing_Potion: "Medium Healing Potion",
		POTION_Large_Healing_Potion: "Large Healing Potion",
		POTION_Giant_Healing_Potion: "Giant Healing Potion",
		POTION_Healing_Elixir: "Healing Elixir",
		POTION_Minor_Strength_Potion: "Minor Strength Potion",
		POTION_Large_Dexterity_Potion: "Large Dexterity Potion",
		UNIQUE_Pyramid: "Pyramid",
	};

	if (m[id]) return m[id];

	// Fallback: ID in lesbaren Namen umwandeln
	const parts = id.replace(/_A$|_B$|_C$/, "").split("_");
	const last = parts[parts.length - 1];
	if (id.startsWith("ARM_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("WPN_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("CON_Food_")) return parts.slice(2).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("CON_Drink_")) return parts.slice(2).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("CON_Potion_")) return parts.slice(2).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("CON_Herb_")) return parts.slice(2).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("FOOD_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("SCROLL_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ") + " Scroll";
	if (id.startsWith("GRN_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("SKILLBOOK_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ") + " Skillbook";
	if (id.startsWith("LOOT_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("TOOL_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("ITEM_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("Gen_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("CONT_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("FUR_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("BOOK_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("QUEST_") || id.startsWith("Quest_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
	if (id.startsWith("HAR_")) return parts.slice(1).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");

	return parts.map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
}

function extractStatsIds(): Set<string> {
	const ids = new Set<string>();
	const statsRegex = /attribute id="Stats" type="22" value="([^"]+)"/g;

	for (const dir of [SESSIONS_DIR, EXAMPLE_DIR]) {
		if (!fs.existsSync(dir)) continue;
		for (const name of fs.readdirSync(dir)) {
			const fullPath = path.join(dir, name);
			if (!fs.statSync(fullPath).isDirectory()) continue;
			const globalsPath = path.join(fullPath, "globals.lsx");
			if (!fs.existsSync(globalsPath)) continue;
			const content = fs.readFileSync(globalsPath, "utf8");
			let m: RegExpExecArray | null;
			while ((m = statsRegex.exec(content)) !== null) {
				const id = m[1];
				if (!id.startsWith("_")) ids.add(id);
			}
		}
	}

	return ids;
}

function main() {
	console.log("Extrahiere Stats-IDs aus Save-Sessions...");
	const ids = extractStatsIds();
	console.log(`  → ${ids.size} eindeutige Stats-IDs gefunden`);

	// Merge in items
	const itemsPath = path.join(process.cwd(), ITEMS_JSON);
	let items: Record<string, { name: string; description: string }> = {};
	if (fs.existsSync(itemsPath)) {
		items = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
	}
	for (const id of ids) {
		if (!items[id]) {
			const name = idToDisplayName(id);
			items[id] = {
				name,
				description: `${name} – Item from Divinity Original Sin 2.`,
			};
		}
	}
	fs.writeFileSync(itemsPath, JSON.stringify(items, null, 2));
	console.log(`  → ${ITEMS_JSON} (${Object.keys(items).length} Einträge)`);

	console.log("\nFertig.");
}

main();
