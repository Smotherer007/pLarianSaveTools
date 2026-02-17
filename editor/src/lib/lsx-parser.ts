/**
 * LSX Parser für meta.lsx und globals.lsx
 * Extrahiert bearbeitbare Daten gemäß Blueprint
 */

export interface CharacterMeta {
	index: number;
	characterName: string;
	characterIconId: string;
}

export interface MetaData {
	difficulty: number;
	level: string;
	saveGameId: number;
	characterMeta: CharacterMeta[];
}

export interface PartyManagerData {
	partyExperience: number;
}

/** Meta.lsx parsen */
export function parseMetaLsx(xml: string): MetaData {
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const result: MetaData = {
		difficulty: 2,
		level: "",
		saveGameId: 0,
		characterMeta: [],
	};

	const getAttr = (el: Element | null, name: string): string =>
		el?.getAttribute(name) ?? "";

	// Difficulty, Level, SaveGameID können in verschiedenen MetaData-Nodes sein
	const diffAttr = doc.querySelector('attribute[id="Difficulty"]');
	if (diffAttr) result.difficulty = parseInt(getAttr(diffAttr, "value"), 10) || 0;

	const levelAttr = doc.querySelector('attribute[id="Level"]');
	if (levelAttr) result.level = getAttr(levelAttr, "value");

	const saveIdAttr = doc.querySelector('attribute[id="SaveGameID"]');
	if (saveIdAttr) result.saveGameId = parseInt(getAttr(saveIdAttr, "value"), 10) || 0;

	const partyMeta = doc.querySelector('node[id="PartyMetaData"]');
	if (partyMeta) {
		const charNodes = partyMeta.querySelectorAll('node[id="CharacterMetaData"]');
		charNodes.forEach((node, i) => {
			const nameAttr = node.querySelector('attribute[id="CharacterName"]');
			const iconAttr = node.querySelector('attribute[id="CharacterIconID"]');
			result.characterMeta.push({
				index: i,
				characterName: getAttr(nameAttr, "value") || "",
				characterIconId: getAttr(iconAttr, "value") || "",
			});
		});
	}

	return result;
}

/** Meta-Änderungen zurück in XML schreiben */
export function applyMetaChanges(xml: string, data: MetaData): string {
	let out = xml;

	// Difficulty
	out = out.replace(
		/(<attribute id="Difficulty" type="[^"]*" value=")[^"]*(")/,
		`$1${data.difficulty}$2`
	);

	// Character names - finde alle CharacterName attribute in CharacterMetaData
	const charNameRegex = /(<attribute id="CharacterName" type="[^"]*" handle="[^"]*" value=")([^"]*)(")/g;
	let idx = 0;
	out = out.replace(charNameRegex, (match, prefix, _oldVal, suffix) => {
		const char = data.characterMeta[idx];
		idx++;
		if (!char) return match;
		const escaped = char.characterName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		return `${prefix}${escaped}${suffix}`;
	});

	return out;
}

/** PartyManager aus globals.lsx - PartyExperience */
export function parsePartyManager(xml: string): PartyManagerData[] {
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const parties: PartyManagerData[] = [];
	const partyNodes = doc.querySelectorAll('region[id="PartyManager"] node[id="Party"]');
	partyNodes.forEach((node) => {
		const expAttr = node.querySelector('attribute[id="PartyExperience"]');
		if (expAttr) {
			parties.push({
				partyExperience: parseInt(expAttr.getAttribute("value") ?? "0", 10),
			});
		}
	});
	return parties;
}
