import { create } from "zustand";
import { parseMetaLsx, type MetaData } from "./lib/lsx-parser";
import { parseGlobalsCharacters, type CharacterData } from "./lib/globals-parser";

interface EditorState {
	sessionId: string | null;
	metaXml: string | null;
	globalsXml: string | null;
	metaData: MetaData | null;
	charactersData: CharacterData[];
	setSession: (id: string, metaXml: string, globalsXml: string) => void;
	setMetaData: (data: MetaData) => void;
	setCharacterData: (index: number, data: Partial<CharacterData>) => void;
	setGlobalsXml: (xml: string) => void;
	loadMeta: (metaXml: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
	sessionId: null,
	metaXml: null,
	globalsXml: null,
	metaData: null,
	charactersData: [],

	setSession: (id, metaXml, globalsXml) => {
		const metaData = parseMetaLsx(metaXml);
		const metaCharacterNames = metaData.characterMeta?.map((c) => c.characterName);
		const charactersData = globalsXml
			? parseGlobalsCharacters(globalsXml, metaCharacterNames)
			: [];
		set({ sessionId: id, metaXml, globalsXml, metaData, charactersData });
	},

	setMetaData: (data) => set({ metaData: data }),

	setGlobalsXml: (xml) => set({ globalsXml: xml }),

	setCharacterData: (index, data) => {
		const { charactersData } = get();
		const next = [...charactersData];
		if (next[index]) {
			next[index] = { ...next[index], ...data };
			if (data.attributes) next[index].attributes = data.attributes.slice(0, 6);
			set({ charactersData: next });
		}
	},

	loadMeta: (metaXml) => {
		const metaData = parseMetaLsx(metaXml);
		set({ metaXml, metaData });
	},
}));
