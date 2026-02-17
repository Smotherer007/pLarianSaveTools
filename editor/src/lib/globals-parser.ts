/**
 * Parser für globals.lsx – Charakter-Stats, Attribute, Fähigkeiten, Talente
 *
 * DOS2-Struktur (region Characters > Character > …):
 * - Character (Root): Vitality, Armor, MagicArmor, MagicPoints, ActionPoints
 * - Stats: Experience, IsPlayer, InParty
 * - PlayerUpgrade: AttributePoints, CombatAbilityPoints, CivilAbilityPoints, TalentPoints, node[id="Attributes"] (6x)
 * - PermanentBoost (unter Stats): Abilities, Talents
 * - PlayerCustomData: Name
 * - SkillManager: Skills
 */

export interface CharacterData {
	/** Index in Party (0-based, Meta-Reihenfolge) */
	index: number;
	/** Index in globals.lsx (für patchCharacterInXml) */
	globalsIndex: number;
	/** true = in aktiver Gruppe, false = im Lager */
	inParty?: boolean;
	/** Character Handle für Referenzen */
	handle?: string;
	vitality: number;
	armor: number;
	magicArmor: number;
	magicPoints: number;
	actionPoints: number;
	experience: number;
	attributePoints: number;
	combatAbilityPoints: number;
	civilAbilityPoints: number;
	talentPoints: number;
	/** 6 Hauptattribute: Might, Finesse, Intelligence, Constitution, Memory, Wits */
	attributes: number[];
	/** Kampf + Zivil Fähigkeiten (Reihenfolge fest) */
	abilities: number[];
	/** Talent-IDs (Object values) */
	talents: number[];
	/** Skills: MapKey = Skill-ID, IsLearned, IsActivated */
	skills: { id: string; learned: boolean; activated: boolean }[];
	/** Inventory-Handle für Inventar-Lookup */
	inventoryHandle?: string;
	/** Name aus PlayerCustomData (für Anzeige, v.a. Begleiter) */
	characterName?: string;
	/** Raw XML node für spätere Patches */
	_statsNode?: Element;
	_characterNode?: Element;
}

const ATTR_NAMES = ["Might", "Finesse", "Intelligence", "Constitution", "Memory", "Wits"] as const;

/** DOS2 XP-Schwellen (Total XP für Level) – Quelle: Fextralife Wiki */
const XP_LEVEL_TABLE = [
	0, 2_000, 8_000, 20_000, 40_000, 70_000, 112_000, 168_000, 240_000, 340_000,
	479_000, 672_000, 941_000, 1_315_000, 1_834_000, 2_556_000, 3_559_000, 4_954_000,
	6_893_000, 9_588_000, 13_334_000, 18_540_000, 25_777_000, 35_836_000, 49_818_000,
	69_253_000, 96_268_000, 133_818_000, 186_013_000, 258_564_000,
];

/** XP in DOS2-Level umrechnen (nicht-linear) */
export function xpToLevel(xp: number): number {
	for (let lvl = XP_LEVEL_TABLE.length; lvl >= 1; lvl--) {
		if (xp >= XP_LEVEL_TABLE[lvl - 1]) return lvl;
	}
	return 1;
}

function getAttr(el: Element | null, name: string): string {
	return el?.getAttribute(name) ?? "";
}

function getInt(el: Element | null, name: string): number {
	return parseInt(getAttr(el, name), 10) || 0;
}

function getBool(el: Element | null, name: string): boolean {
	const v = getAttr(el, name);
	return v === "True" || v === "true" || v === "1";
}

/** Talent-Bitflags: Extrahiert Talent-IDs aus Slot-Werten (32 Bits pro Slot). */
export function slotValuesToTalentIds(slotValues: number[]): number[] {
	const ids: number[] = [];
	slotValues.forEach((value, slotIndex) => {
		for (let i = 0; i < 32; i++) {
			if ((value & (1 << i)) !== 0) ids.push(slotIndex * 32 + i);
		}
	});
	return ids;
}

/** Konvertiert Talent-IDs in Slot-Werte (4 Slots, je 32 Bits). */
function talentIdsToSlotValues(talentIds: number[], numSlots: number): number[] {
	const values = new Array(numSlots).fill(0);
	for (const id of talentIds) {
		if (id < 0 || id >= 128) continue;
		const slot = Math.min(Math.floor(id / 32), numSlots - 1);
		const bitInSlot = id % 32;
		values[slot] |= 1 << bitInSlot;
	}
	return values;
}

/** Character-Name aus PlayerCustomData (Kind von Character) */
function getCharacterName(charEl: Element): string {
	const nameAttr = charEl.querySelector('node[id="PlayerCustomData"] attribute[id="Name"]');
	return getAttr(nameAttr, "value") || "";
}

/** Alle Spieler-Charaktere aus globals.lsx extrahieren (IsPlayer=true), optional nach Meta-Reihenfolge sortiert */
export function parseGlobalsCharacters(xml: string, metaCharacterNames?: string[]): CharacterData[] {
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const raw: (CharacterData & { _charName: string })[] = [];

	const characterNodes = doc.querySelectorAll(
		'region[id="Characters"] node[id="Character"]'
	);

	let globalsIndex = 0;
	characterNodes.forEach((charEl) => {
		const statsEl = charEl.querySelector('node[id="Stats"]');
		if (!statsEl) return;

		const isPlayer = getBool(statsEl.querySelector('attribute[id="IsPlayer"]'), "value");
		const inParty = getBool(statsEl.querySelector('attribute[id="InParty"]'), "value");
		if (!isPlayer) return;

		// Attribute: in DOS2 unter PlayerUpgrade (nicht Stats/PermanentBoost!)
		const attrs: number[] = [];
		const playerUpgrade = charEl.querySelector('node[id="PlayerUpgrade"]');
		const attrsSource = playerUpgrade ?? statsEl;
		attrsSource.querySelectorAll('node[id="Attributes"]').forEach((n) => {
			const obj = n.querySelector('attribute[id="Object"]');
			if (obj && obj.getAttribute("type") === "4") attrs.push(getInt(obj, "value"));
		});

		const permBoost = statsEl.querySelector('node[id="PermanentBoost"]');
		const abilities: number[] = [];
		let talents: number[] = [];
		if (permBoost) {
			permBoost.querySelectorAll('node[id="Abilities"]').forEach((n) => {
				abilities.push(getInt(n.querySelector('attribute[id="Object"]'), "value"));
			});
		}
		// Talente: PlayerUpgrade hat die echten Werte (Erstellen/Leveln), PermanentBoost oft 0
		const talentsSource = playerUpgrade ?? permBoost;
		if (talentsSource) {
			const slotValues: number[] = [];
			talentsSource.querySelectorAll('node[id="Talents"]').forEach((n) => {
				const obj = n.querySelector('attribute[id="Object"]');
				if (obj && obj.getAttribute("type") === "5")
					slotValues.push(parseInt(obj.getAttribute("value") ?? "0", 10));
			});
			talents = slotValuesToTalentIds(slotValues);
		}

		const skills: { id: string; learned: boolean; activated: boolean }[] = [];
		const skillManager = charEl.querySelector('node[id="SkillManager"]');
		skillManager?.querySelectorAll('node[id="Skills"]').forEach((s) => {
			const key = s.querySelector('attribute[id="MapKey"]');
			if (key) {
				skills.push({
					id: getAttr(key, "value"),
					learned: getBool(s.querySelector('attribute[id="IsLearned"]'), "value"),
					activated: getBool(s.querySelector('attribute[id="IsActivated"]'), "value"),
				});
			}
		});

		const charName = getCharacterName(charEl);
		const inventoryHandle = getAttr(charEl.querySelector('attribute[id="Inventory"]'), "value");
		// Punkte-Pools: in PlayerUpgrade (wie Attribute), Fallback Stats
		const pointsSource = playerUpgrade ?? statsEl;
		raw.push({
			index: 0,
			globalsIndex: globalsIndex++,
			inParty,
			characterName: charName,
			inventoryHandle: inventoryHandle || undefined,
			vitality: getInt(charEl.querySelector('attribute[id="Vitality"]'), "value"),
			armor: getInt(charEl.querySelector('attribute[id="Armor"]'), "value"),
			magicArmor: getInt(charEl.querySelector('attribute[id="MagicArmor"]'), "value"),
			magicPoints: getInt(charEl.querySelector('attribute[id="MagicPoints"]'), "value"),
			actionPoints: getInt(charEl.querySelector('attribute[id="ActionPoints"]'), "value"),
			experience: getInt(statsEl.querySelector('attribute[id="Experience"]'), "value"),
			attributePoints: getInt(pointsSource.querySelector('attribute[id="AttributePoints"]'), "value"),
			combatAbilityPoints: getInt(pointsSource.querySelector('attribute[id="CombatAbilityPoints"]'), "value"),
			civilAbilityPoints: getInt(pointsSource.querySelector('attribute[id="CivilAbilityPoints"]'), "value"),
			talentPoints: getInt(pointsSource.querySelector('attribute[id="TalentPoints"]'), "value"),
			attributes: attrs.slice(0, 6),
			abilities,
			talents,
			skills,
			_statsNode: statsEl,
			_characterNode: charEl,
			_charName: charName,
		});
	});

	// Nach Meta-Reihenfolge sortieren, dann restliche (Lager-Begleiter)
	if (metaCharacterNames && metaCharacterNames.length > 0) {
		const byName = new Map<string, (CharacterData & { _charName: string })>();
		raw.forEach((r) => byName.set((r as CharacterData & { _charName: string })._charName, r as CharacterData & { _charName: string }));
		const result: CharacterData[] = [];
		const matched = new Set<(CharacterData & { _charName: string })>();
		metaCharacterNames.forEach((name, metaIndex) => {
			const char = byName.get(name);
			if (char) {
				matched.add(char);
				const { _charName, ...data } = char;
				result.push({ ...data, index: metaIndex, globalsIndex: char.globalsIndex });
			}
		});
		raw.forEach((r) => {
			if (!matched.has(r as CharacterData & { _charName: string })) {
				const { _charName, ...data } = r as CharacterData & { _charName: string };
				result.push({ ...data, index: result.length, globalsIndex: (r as CharacterData).globalsIndex });
			}
		});
		if (result.length > 0) return result;
	}

	return raw.map((r, i) => {
		const { _charName, ...data } = r as CharacterData & { _charName: string };
		return { ...data, index: i };
	});
}

/** Charakter-Änderungen in globals XML anwenden */
export function applyCharacterChanges(
	xml: string,
	metaIndexToChar: Map<number, CharacterData>
): string {
	// Wir müssen die XML gezielt patchen. Da die Struktur komplex ist, nutzen wir
	// einen Ansatz: für jeden Spieler-Charakter die Werte ersetzen.
	// Die Reihenfolge der Character-Nodes mit IsPlayer+InParty muss erhalten bleiben.

	let out = xml;
	let charIdx = 0;

	// Regex-basierter Ersatz für jeden Character-Block
	// Suche nach Stats-Blöcken mit IsPlayer/InParty und ersetze die Werte
	const statsBlockRegex = /<node id="Stats">\s*<attribute id="BonusActionPoints"[^>]*>[\s\S]*?<attribute id="IsPlayer" type="[^"]*" value="True" \/>\s*<attribute id="InParty" type="[^"]*" value="True" \/>[\s\S]*?<attribute id="Experience" type="[^"]*" value="(\d+)" \/>/g;

	out = out.replace(statsBlockRegex, () => {
		const data = metaIndexToChar.get(charIdx);
		charIdx++;
		if (!data) return arguments[0];
		const match = arguments[0] as string;
		return match.replace(
			/<attribute id="Experience" type="[^"]*" value="\d+" \/>/,
			`<attribute id="Experience" type="4" value="${data.experience}" />`
		);
	});

	// Vitality, Armor, MagicArmor am Character
	// Wir müssen vorsichtig sein - nur bei IsPlayer-Chars ersetzen
	// Einfacherer Ansatz: alle Attribute durchgehen und in Reihenfolge ersetzen
	// Das ist fehleranfällig. Besser: DOM-Manipulation und zurück zu XML serialisieren.

	// Für jetzt: nur die einfach ersetzbaren Werte in den Character-Blöcken
	// die VOR dem Stats-Node kommen (Vitality, Armor, etc.)
	const charVitalityRegex = /(<attribute id="Vitality" type="4" value=")(\d+)(" \/>)/g;
	let vIdx = 0;
	out = out.replace(charVitalityRegex, () => {
		const data = metaIndexToChar.get(vIdx);
		vIdx++;
		if (!data) return arguments[0];
		return `${arguments[1]}${data.vitality}${arguments[3]}`;
	});

	return out;
}

/** Einfacheres Apply: Ersetze Attribute in Character-Blöcken (nur IsPlayer) */
export function patchCharacterInXml(
	xml: string,
	characterIndex: number,
	updates: Partial<CharacterData>
): string {
	// Wir iterieren und zählen IsPlayer-Chars
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const serializer = new XMLSerializer();

	const characterNodes = doc.querySelectorAll(
		'region[id="Characters"] node[id="Character"]'
	);

	let playerCount = 0;
	for (const charEl of Array.from(characterNodes)) {
		const statsEl = charEl.querySelector('node[id="Stats"]');
		if (!statsEl) continue;
		if (!getBool(statsEl.querySelector('attribute[id="IsPlayer"]'), "value")) continue;

		if (playerCount === characterIndex) {
			const playerUpgrade = charEl.querySelector('node[id="PlayerUpgrade"]');
			const pointsTarget = playerUpgrade ?? statsEl;

			// Patche diesen Character
			if (updates.vitality !== undefined) {
				const a = charEl.querySelector('attribute[id="Vitality"]');
				if (a) a.setAttribute("value", String(updates.vitality));
			}
			if (updates.armor !== undefined) {
				const a = charEl.querySelector('attribute[id="Armor"]');
				if (a) a.setAttribute("value", String(updates.armor));
			}
			if (updates.magicArmor !== undefined) {
				const a = charEl.querySelector('attribute[id="MagicArmor"]');
				if (a) a.setAttribute("value", String(updates.magicArmor));
			}
			if (updates.magicPoints !== undefined) {
				const a = charEl.querySelector('attribute[id="MagicPoints"]');
				if (a) a.setAttribute("value", String(updates.magicPoints));
			}
			if (updates.actionPoints !== undefined) {
				const a = charEl.querySelector('attribute[id="ActionPoints"]');
				if (a) a.setAttribute("value", String(updates.actionPoints));
			}
			if (updates.experience !== undefined) {
				const a = statsEl.querySelector('attribute[id="Experience"]');
				if (a) a.setAttribute("value", String(updates.experience));
			}
			// Punkte-Pools: in PlayerUpgrade (wie Attribute)
			if (updates.attributePoints !== undefined) {
				const a = pointsTarget.querySelector('attribute[id="AttributePoints"]');
				if (a) a.setAttribute("value", String(updates.attributePoints));
			}
			if (updates.combatAbilityPoints !== undefined) {
				const a = pointsTarget.querySelector('attribute[id="CombatAbilityPoints"]');
				if (a) a.setAttribute("value", String(updates.combatAbilityPoints));
			}
			if (updates.civilAbilityPoints !== undefined) {
				const a = pointsTarget.querySelector('attribute[id="CivilAbilityPoints"]');
				if (a) a.setAttribute("value", String(updates.civilAbilityPoints));
			}
			if (updates.talentPoints !== undefined) {
				const a = pointsTarget.querySelector('attribute[id="TalentPoints"]');
				if (a) a.setAttribute("value", String(updates.talentPoints));
			}
			// Attributes (6 Werte) – in PlayerUpgrade (nicht Stats)
			if (updates.attributes && updates.attributes.length >= 6) {
				const attrsContainer = playerUpgrade ?? statsEl;
				const attrNodes = attrsContainer.querySelectorAll('node[id="Attributes"]');
				updates.attributes.slice(0, 6).forEach((val, i) => {
					const node = attrNodes[i];
					const objAttr = node?.querySelector('attribute[id="Object"]');
					if (objAttr) objAttr.setAttribute("value", String(val));
				});
			}
			// Talente: PlayerUpgrade oder Stats > PermanentBoost (4 Slots mit Bitflags)
			if (updates.talents !== undefined) {
				const talentsTarget = playerUpgrade ?? charEl.querySelector('node[id="Stats"] node[id="PermanentBoost"]');
				const talentNodes = talentsTarget ? Array.from(talentsTarget.querySelectorAll('node[id="Talents"]')) : [];
				const values = talentIdsToSlotValues(updates.talents, Math.max(talentNodes.length, 4));
				talentNodes.forEach((node, i) => {
					const obj = node.querySelector('attribute[id="Object"]');
					if (obj) obj.setAttribute("value", String(values[i] ?? 0));
				});
			}
			break;
		}
		playerCount++;
	}

	return serializer.serializeToString(doc);
}

/** Amount eines Inventar-Items patchen (region Items, Creator/Item nach Index gepaart) */
export function patchItemAmount(xml: string, itemHandle: string, amount: number): string {
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const creators = doc.querySelectorAll('region[id="Items"] node[id="Creator"]');
	const items = doc.querySelectorAll('region[id="Items"] node[id="Item"]');
	let idx = -1;
	creators.forEach((c, i) => {
		if (getAttr(c.querySelector('attribute[id="Handle"]'), "value") === itemHandle) idx = i;
	});
	if (idx < 0 || idx >= items.length) return xml;
	const itemEl = items[idx];
	let amountAttr = itemEl.querySelector('attribute[id="Amount"]');
	if (!amountAttr) {
		amountAttr = doc.createElementNS("", "attribute");
		amountAttr.setAttribute("id", "Amount");
		amountAttr.setAttribute("type", "4");
		itemEl.appendChild(amountAttr);
	}
	amountAttr.setAttribute("value", String(Math.max(1, amount)));
	return new XMLSerializer().serializeToString(doc);
}

export { ATTR_NAMES };
