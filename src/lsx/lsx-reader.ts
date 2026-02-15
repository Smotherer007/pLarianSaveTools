import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { LSFNode, LSFAttribute, NodeAttributeType, TranslatedFSStringValue } from "../lsf/types.js";

export interface LsxVersion {
	major: number;
	minor: number;
	revision: number;
	build: number;
	/** e.g. "v1,bswap_guids" – UUIDs in LSX are byte-swapped */
	lslibMeta?: string;
}

function parseXml(xml: string): any {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@_"
	});
	return parser.parse(xml);
}

function getAttrs(el: any): Record<string, string> {
	if (!el || typeof el !== "object") return {};
	const attrs: Record<string, string> = {};
	for (const k of Object.keys(el)) {
		if (k.startsWith("@_")) attrs[k.slice(2)] = String(el[k] ?? "");
	}
	return attrs;
}

function parseVersion(versionEl: any): LsxVersion {
	const a = versionEl ? getAttrs(versionEl) : {};
	if (!a) return { major: 4, minor: 0, revision: 0, build: 0 };
	return {
		major: parseInt(a.major ?? "4", 10),
		minor: parseInt(a.minor ?? "0", 10),
		revision: parseInt(a.revision ?? "0", 10),
		build: parseInt(a.build ?? "0", 10),
		lslibMeta: a.lslib_meta ?? a.lslibMeta
	};
}

function parseType(typeStr: string | number): NodeAttributeType {
	const t = typeof typeStr === "number" ? typeStr : parseInt(String(typeStr), 10);
	if (!isNaN(t) && t >= 0 && t <= 33) return t as NodeAttributeType;
	const nameMap: Record<string, NodeAttributeType> = {
		FixedString: NodeAttributeType.FixedString,
		Int: NodeAttributeType.Int,
		UInt: NodeAttributeType.UInt,
		Float: NodeAttributeType.Float,
		Bool: NodeAttributeType.Bool,
		LSString: NodeAttributeType.LSString,
		TranslatedString: NodeAttributeType.TranslatedString,
		LSWString: NodeAttributeType.LSWString,
		UUID: NodeAttributeType.UUID,
		Byte: NodeAttributeType.Byte,
		Short: NodeAttributeType.Short,
		UShort: NodeAttributeType.UShort,
		Double: NodeAttributeType.Double,
		Long: NodeAttributeType.Long,
		Int64: NodeAttributeType.Int64,
		Int8: NodeAttributeType.Int8
	};
	return nameMap[String(typeStr)] ?? NodeAttributeType.String;
}

function parseTranslatedFSStringArguments(argsEl: any): TranslatedFSStringValue["arguments"] {
	if (!argsEl) return undefined;
	const argList = argsEl?.argument ?? [];
	const arr = Array.isArray(argList) ? argList : [argList];
	const result: NonNullable<TranslatedFSStringValue["arguments"]> = [];
	for (const a of arr) {
		if (!a || typeof a !== "object") continue;
		const attrs = getAttrs(a);
		const key = attrs.key ?? "";
		const valueAttr = attrs.value ?? "";
		const stringEl = a?.string;
		const arg: { key: string; value: string; string?: TranslatedFSStringValue } = { key, value: valueAttr };
		if (stringEl) {
			const s = Array.isArray(stringEl) ? stringEl[0] : stringEl;
			const sAttrs = getAttrs(s);
			const nestedArgs = s?.arguments ? parseTranslatedFSStringArguments(s.arguments) : undefined;
			arg.string = {
				value: sAttrs.value ?? "",
				handle: sAttrs.handle ?? "",
				...(nestedArgs && nestedArgs.length > 0 ? { arguments: nestedArgs } : {})
			};
		}
		result.push(arg);
	}
	return result.length > 0 ? result : undefined;
}

/** bswap_guids: Convert LSX format back to normal format for LSF writing (inverse of formatUuidForLsx) */
function parseUuidFromLsx(lsxUuid: string): string {
	const m = lsxUuid.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i);
	if (!m) return lsxUuid;
	const rev = (s: string) => (s.match(/../g) ?? []).reverse().join("");
	const swap2 = (s: string) => (s.length === 4 ? s[2] + s[3] + s[0] + s[1] : s);
	return `${rev(m[1])}-${swap2(m[2])}-${swap2(m[3])}-${m[4]}-${m[5]}`;
}

function parseAttributeValue(type: NodeAttributeType, valueStr: string, handle?: string, el?: any, bswapGuids?: boolean): any {
	if (valueStr === undefined) valueStr = "";
	if (type === NodeAttributeType.TranslatedString || type === NodeAttributeType.TranslatedFSString) {
		const args = type === NodeAttributeType.TranslatedFSString && el ? parseTranslatedFSStringArguments(el.arguments) : undefined;
		return { value: valueStr, handle: handle ?? "", ...(args && args.length > 0 ? { arguments: args } : {}) };
	}
	if (type === NodeAttributeType.UUID && bswapGuids && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valueStr)) {
		return parseUuidFromLsx(valueStr);
	}
	if (type === NodeAttributeType.Bool) {
		return valueStr === "True" || valueStr === "true" || valueStr === "1";
	}
	if (type === NodeAttributeType.Byte || type === NodeAttributeType.Int8) {
		return parseInt(valueStr, 10) || 0;
	}
	if (type === NodeAttributeType.Short || type === NodeAttributeType.UShort) {
		return parseInt(valueStr, 10) || 0;
	}
	if (type === NodeAttributeType.Int || type === NodeAttributeType.UInt) {
		return parseInt(valueStr, 10) || 0;
	}
	if (type === NodeAttributeType.Float || type === NodeAttributeType.Double) {
		return parseFloat(valueStr) || 0;
	}
	return valueStr;
}

function parseAttribute(el: any, bswapGuids: boolean): LSFAttribute | null {
	const a = getAttrs(el);
	if (!a.id) return null;
	const type = parseType(a.type ?? "20");
	const valueStr = a.value ?? "";
	const handle = a.handle;
	return {
		name: a.id,
		type,
		value: parseAttributeValue(type, valueStr, handle, el, bswapGuids)
	};
}

function parseNode(el: any, bswapGuids: boolean): LSFNode | null {
	const a = getAttrs(el);
	const name = a.id ?? "Node";
	const node: LSFNode = { name, attributes: {}, children: [] };
	if (a.key) node.key = a.key;

	const attrs = el?.attribute ?? [];
	const attrList = Array.isArray(attrs) ? attrs : [attrs];
	for (const attrEl of attrList) {
		const attr = parseAttribute(attrEl, bswapGuids);
		if (attr) node.attributes[attr.name] = attr;
	}

	const childrenEl = el?.children;
	if (childrenEl) {
		const nodes = childrenEl?.node ?? [];
		const nodeList = Array.isArray(nodes) ? nodes : [nodes];
		for (const childEl of nodeList) {
			if (childEl && typeof childEl === "object") {
				const child = parseNode(childEl, bswapGuids);
				if (child) node.children.push(child);
			}
		}
	}

	return node;
}

function extractRegionContent(save: any): { regionId: string; root: any }[] {
	const region = save?.region;
	if (!region) return [];
	const regionList = Array.isArray(region) ? region : [region];
	const result: { regionId: string; root: any }[] = [];
	for (const r of regionList) {
		if (!r) continue;
		const regionId = getAttrs(r).id ?? "Region";
		const inner = r.node;
		if (!inner) continue;
		const innerList = Array.isArray(inner) ? inner : [inner];
		const root = innerList[0];
		if (!root) continue;
		result.push({ regionId, root });
	}
	return result;
}

export function parseLsx(pathOrXml: string): { root: LSFNode; version: LsxVersion } {
	const xml = pathOrXml.startsWith("<") || pathOrXml.includes("<?xml") ? pathOrXml : readFileSync(pathOrXml, "utf8");
	const doc = parseXml(xml);
	const save = doc?.save;
	if (!save) throw new Error("Invalid LSX: no <save> root");

	const version = parseVersion(save.version);
	const regions = extractRegionContent(save);
	if (regions.length === 0) throw new Error("Invalid LSX: no region/node structure");

	const bswapGuids = version.lslibMeta?.includes("bswap_guids") ?? false;

	// LSLib: Region IS the first node (LSXReader line 125–129: if stack.Count==0 then node=currentRegion)
	// No wrapper – first node becomes region root directly. LSLib preserves structure
	// (e.g. MetaData without attrs → MetaData with attrs → ModuleSettings), no flattening.
	const regionNodes: LSFNode[] = [];
	for (const { root: rootEl } of regions) {
		const rootNode = parseNode(rootEl, bswapGuids);
		if (!rootNode) continue;
		regionNodes.push(rootNode);
	}

	let root: LSFNode;
	if (regionNodes.length === 1) {
		root = regionNodes[0];
	} else {
		root = { name: "save", attributes: {}, children: regionNodes };
	}

	return { root, version };
}
