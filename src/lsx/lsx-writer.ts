import { LSFNode, LSFAttribute, NodeAttributeType, TranslatedFSStringValue } from "../lsf/types.js";

export interface LsxVersion {
	major: number;
	minor: number;
	revision: number;
	build: number;
}

export interface LsxOptions {
	/** Numerische Type-IDs wie LSLib (type="22" statt type="FixedString") */
	numericTypes?: boolean;
	/** lslib_meta Attribut (z.B. "v1,bswap_guids") */
	lslibMeta?: string;
}

export function convertLsfToLsx(root: LSFNode, version?: LsxVersion, options?: LsxOptions): string {
	const v = version ?? { major: 4, minor: 0, revision: 0, build: 0 };
	const opts = {
		numericTypes: v.major < 4,
		lslibMeta: "v1,bswap_guids",
		...options
	};

	const BOM = "\uFEFF";
	const EOL = "\r\n";
	let xml = BOM + '<?xml version="1.0" encoding="utf-8"?>' + EOL;
	xml += "<save>" + EOL;
	xml += `\t<version major="${v.major}" minor="${v.minor}" revision="${v.revision}" build="${v.build}"`;
	if (opts.lslibMeta) xml += ` lslib_meta="${opts.lslibMeta}"`;
	xml += " />" + EOL;

	// Mehrere Regionen (globals.lsf) oder einzelne Region (meta.lsf)
	const regions = root.name === "save" && root.children.length > 0 ? root.children : [root];
	for (const region of regions) {
		xml += `\t<region id="${escapeXml(region.name)}">` + EOL;
		xml += serializeNode(region, 2, opts, EOL);
		xml += `\t</region>` + EOL;
	}
	xml += "</save>";
	return xml;
}

function serializeNode(node: LSFNode, indent: number, opts: LsxOptions, eol: string = "\n"): string {
	const tab = "\t";
	const spacing = tab.repeat(indent);
	const inner = tab.repeat(indent + 1);
	const keyAttr = node.key ? ` key="${escapeXml(node.key)}"` : "";
	let xml = `${spacing}<node id="${escapeXml(node.name)}"${keyAttr}>${eol}`;

	for (const [name, attr] of Object.entries(node.attributes)) {
		xml += serializeAttribute(name, attr, inner, opts, eol);
	}

	if (node.children.length > 0) {
		xml += `${inner}<children>${eol}`;
		for (const child of node.children) {
			xml += serializeNode(child, indent + 2, opts, eol);
		}
		xml += `${inner}</children>${eol}`;
	}

	xml += `${spacing}</node>${eol}`;
	return xml;
}

function serializeTranslatedFSStringArgs(args: NonNullable<TranslatedFSStringValue["arguments"]>, inner: string, eol: string): string {
	let xml = "";
	for (const arg of args) {
		if (arg.string) {
			const s = arg.string;
			const nestedArgs = s.arguments && s.arguments.length > 0;
			xml += `${inner}<argument key="${escapeXml(arg.key)}" value="${escapeXml(arg.value)}">${eol}`;
			if (nestedArgs) {
				xml += `${inner}\t<string value="${escapeXml(s.value)}" handle="${escapeXml(s.handle)}" arguments="${s.arguments!.length}">${eol}`;
				xml += serializeTranslatedFSStringArgs(s.arguments!, inner + "\t\t", eol);
				xml += `${inner}\t</string>${eol}`;
			} else {
				xml += `${inner}\t<string value="${escapeXml(s.value)}" handle="${escapeXml(s.handle)}" arguments="0" />${eol}`;
			}
			xml += `${inner}</argument>${eol}`;
		} else {
			xml += `${inner}<argument key="${escapeXml(arg.key)}" value="${escapeXml(arg.value)}" />${eol}`;
		}
	}
	return xml;
}

function serializeAttribute(name: string, attr: LSFAttribute, spacing: string, opts: LsxOptions, eol: string = "\n"): string {
	const typeStr = opts.numericTypes ? String(attr.type) : (NodeAttributeType[attr.type] ?? "Unknown");
	const inner = spacing + "\t";
	let valueStr: string;
	let extraAttrs = "";

	if (attr.type === NodeAttributeType.TranslatedString || attr.type === NodeAttributeType.TranslatedFSString) {
		const ts = attr.value as TranslatedFSStringValue | { value: string; handle: string };
		if (ts && typeof ts === "object" && "handle" in ts) {
			valueStr = ts.value || "";
			if (ts.handle) extraAttrs = ` handle="${escapeXml(ts.handle)}"`;
			const args = (ts as TranslatedFSStringValue).arguments;
			if (args && args.length > 0) {
				extraAttrs += ` arguments="${args.length}"`;
				const argsXml = serializeTranslatedFSStringArgs(args, inner, eol);
				return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}"${extraAttrs} value="${escapeXml(valueStr)}">${eol}${inner}<arguments>${eol}${argsXml}${inner}</arguments>${eol}${spacing}</attribute>${eol}`;
			}
		} else {
			valueStr = String(attr.value);
		}
		return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}"${extraAttrs} value="${escapeXml(valueStr)}" />${eol}`;
	} else if (attr.type === NodeAttributeType.Bool) {
		valueStr = attr.value ? "True" : "False";
	} else if ((attr.type === NodeAttributeType.Float || attr.type === NodeAttributeType.Double) && typeof attr.value === "number" && Number.isFinite(attr.value)) {
		valueStr = formatFloat(attr.value);
	} else {
		valueStr = String(attr.value);
	}

	return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}" value="${escapeXml(valueStr)}"${extraAttrs} />${eol}`;
}

function formatFloat(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const s5 = n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
	const s6 = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
	const tol = 4e-6;
	return Math.abs(parseFloat(s5) - n) < tol ? s5 : s6;
}

function escapeXml(unsafe: string): string {
	return unsafe.replace(/[<>&"']/g, (c) => {
		switch (c) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case '"':
				return "&quot;";
			case "'":
				return "&apos;";
			default:
				return c;
		}
	});
}
