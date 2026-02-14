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
	const hasAttrs = Object.keys(node.attributes).length > 0;
	const hasChildren = node.children.length > 0;

	// LSLib: leere Nodes als selbstschließend <node id="X" />
	if (!hasAttrs && !hasChildren) {
		return `${spacing}<node id="${escapeXml(node.name)}"${keyAttr} />${eol}`;
	}

	let xml = `${spacing}<node id="${escapeXml(node.name)}"${keyAttr}>${eol}`;

	for (const [name, attr] of Object.entries(node.attributes)) {
		xml += serializeAttribute(name, attr, inner, opts, eol);
	}

	if (hasChildren) {
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
			const args = (ts as TranslatedFSStringValue).arguments;
			const handleAttr = ts.handle ? ` handle="${escapeXml(ts.handle)}"` : "";
			const isFS = attr.type === NodeAttributeType.TranslatedFSString;
			const argsCount = args?.length ?? 0;
			const argsAttr = isFS ? ` arguments="${argsCount}"` : "";
			// LSLib: TranslatedString (28) = handle, value | TranslatedFSString (33) = value, handle, arguments
			const valuePart = ` value="${escapeXml(valueStr)}"`;
			if (args && args.length > 0) {
				const argsXml = serializeTranslatedFSStringArgs(args, inner + "\t", eol);
				const attrs = isFS ? valuePart + handleAttr + argsAttr : handleAttr + valuePart;
				return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}"${attrs}>${eol}${inner}<arguments>${eol}${argsXml}${inner}</arguments>${eol}${spacing}</attribute>${eol}`;
			}
			const attrs = isFS ? valuePart + handleAttr + argsAttr : handleAttr + valuePart;
			return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}"${attrs} />${eol}`;
		} else {
			valueStr = String(attr.value);
		}
		return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}" value="${escapeXml(valueStr)}"${extraAttrs} />${eol}`;
	} else if (attr.type === NodeAttributeType.Bool) {
		valueStr = attr.value ? "True" : "False";
	} else if ((attr.type === NodeAttributeType.Float || attr.type === NodeAttributeType.Double) && typeof attr.value === "number" && Number.isFinite(attr.value)) {
		valueStr = formatFloat(attr.value);
	} else if (attr.type === NodeAttributeType.UUID && typeof attr.value === "string" && opts.lslibMeta?.includes("bswap_guids")) {
		valueStr = formatUuidForLsx(attr.value);
	} else if (
		(attr.type === NodeAttributeType.Vec2 || attr.type === NodeAttributeType.Vec3 || attr.type === NodeAttributeType.Vec4) &&
		typeof attr.value === "string"
	) {
		valueStr = formatVecForLsx(attr.value);
	} else if (attr.type === NodeAttributeType.Byte && typeof attr.value === "number") {
		// LSLib: Byte (type 1) als unsigned 0–255 ausgeben (z.B. Color)
		valueStr = String((attr.value >>> 0) & 0xff);
	} else {
		valueStr = String(attr.value);
	}

	return `${spacing}<attribute id="${escapeXml(name)}" type="${typeStr}" value="${escapeXml(valueStr)}"${extraAttrs} />${eol}`;
}

const _f32 = new Float32Array(1);
function toFloat32(n: number): number {
	_f32[0] = n;
	return _f32[0];
}

/** Scientific notation – Minimum Ziffern für Float32-Roundtrip (LSLib: -3.61999E-06) */
function formatFloatScientific(v: number): string {
	const fmt = (digits: number) => {
		const s = v.toExponential(digits).replace("e", "E");
		const m = s.match(/E([+-])(\d+)$/);
		if (m) {
			const exp = m[2].padStart(2, "0");
			return s.replace(/E[+-]\d+$/, `E${m[1]}${exp}`);
		}
		return s;
	};
	// LSLib nutzt Minimum (5–8 Ziffern) für Roundtrip
	for (let d = 5; d <= 8; d++) {
		const s = fmt(d);
		const parsed = parseFloat(s.replace("E", "e"));
		if (toFloat32(parsed) === v) return s;
	}
	return fmt(6);
}

/** Round half to even (Banker's Rounding) – C# .NET Core 2.1+ nutzt dies für float.ToString */
function roundHalfToEven(n: number): number {
	const r = Math.round(n);
	if (Math.abs(n - r) === 0.5) return r % 2 === 0 ? r : n > 0 ? r - 1 : r + 1;
	return r;
}

/** LSLib-kompatibel: Minimum Dezimalstellen für Float32-Roundtrip (C# float.ToString mit Round half to even) */
function formatFloat(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const v = toFloat32(n);
	if (v === 0) return "0";
	// Nur echte Null als "0"/"-0" – sehr kleine Werte wie -1.377e-11 nutzen Scientific (LSLib)
	const MIN_NORMAL_F32 = 1.175494e-38;
	if (Math.abs(v) < MIN_NORMAL_F32) return v < 0 ? "-0" : "0";
	// C# "G" format: Scientific für |v| < 1e-4 oder |v| >= 1e15
	if (Math.abs(v) < 1e-4 || Math.abs(v) >= 1e15) {
		return formatFloatScientific(v);
	}
	for (let d = 0; d <= 15; d++) {
		let s: string;
		if (d === 0) {
			s = String(roundHalfToEven(v));
		} else {
			const scaled = v * Math.pow(10, d);
			const rounded = roundHalfToEven(scaled);
			s = (rounded / Math.pow(10, d)).toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
		}
		if (s === "" || s === "-") continue;
		const parsed = parseFloat(s);
		if (toFloat32(parsed) === v) return s;
	}
	const scaled = v * 1e6;
	return (roundHalfToEven(scaled) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** bswap_guids: erste 8 Bytes für LSX (LSLib ByteSwapGuid-Format) */
function formatUuidForLsx(uuid: string): string {
	const m = uuid.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i);
	if (!m) return uuid;
	// Gruppe 1 (8 hex): 4×2-Byte in Reihenfolge umkehren (427baeec -> ecae7b42)
	const p1 = m[1].match(/../g)!.reverse().join("");
	// Gruppen 2+3 (je 4 hex): 2-Byte-Paar swappen (4d05->054d, 5443->4354)
	const swap2 = (s: string) => (s.length === 4 ? s[2] + s[3] + s[0] + s[1] : s);
	const p2 = swap2(m[2]);
	const p3 = swap2(m[3]);
	return `${p1}-${p2}-${p3}-${m[4]}-${m[5]}`;
}

/** Vec2/Vec3/Vec4: jede Komponente mit formatFloat (LSLib C# float.ToString) */
function formatVecForLsx(vecStr: string): string {
	return vecStr
		.split(/\s+/)
		.map((s) => {
			const n = parseFloat(s);
			return Number.isFinite(n) ? formatFloat(n) : s;
		})
		.join(" ");
}

/** LSLib-kompatibel: Nur <>&" escapen, Apostroph nicht (LSLib nutzt value="...") */
function escapeXml(unsafe: string): string {
	return unsafe.replace(/[<>&"]/g, (c) => {
		switch (c) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case '"':
				return "&quot;";
			default:
				return c;
		}
	});
}
