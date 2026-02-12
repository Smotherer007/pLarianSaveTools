/**
 * LSF Types – an LSLib AttributeType angepasst
 * https://github.com/Norbyte/lslib/blob/master/LSLib/LS/NodeAttribute.cs
 */

export enum NodeAttributeType {
	None = 0,
	Byte = 1,
	Short = 2,
	UShort = 3,
	Int = 4,
	UInt = 5,
	Float = 6,
	Double = 7,
	IVec2 = 8,
	IVec3 = 9,
	IVec4 = 10,
	Vec2 = 11,
	Vec3 = 12,
	Vec4 = 13,
	Mat2 = 14,
	Mat3 = 15,
	Mat3x4 = 16,
	Mat4x3 = 17,
	Mat4 = 18,
	Bool = 19,
	String = 20,
	Path = 21,
	FixedString = 22,
	LSString = 23,
	ULongLong = 24,
	ScratchBuffer = 25,
	Long = 26,
	Int8 = 27,
	TranslatedString = 28,
	WString = 29,
	LSWString = 30,
	UUID = 31,
	Int64 = 32,
	TranslatedFSString = 33
}

export interface LSFHeader {
	magic: string;
	version: number;
	engineVersion: bigint;
}

export interface LSFMetadata {
	uncompressedSize: number;
	compressedSize: number;
}

export interface LSFMetadataBlock {
	strings: LSFMetadata;
	nodes: LSFMetadata;
	attributes: LSFMetadata;
	values: LSFMetadata;
	keys?: LSFMetadata; // BG3 v6+ (KeysAndAdjacency)
	compressionFlags: number;
	metadataFormat: number;
}

export interface LSFNodeEntry {
	nameIndex: number;
	parentIndex: number;
	nextSiblingIndex: number;
	firstAttributeIndex: number;
}

export interface LSFAttributeEntry {
	nameIndex: number;
	type: NodeAttributeType;
	length: number;
	nodeIndex: number;
	nextAttributeIndex: number;
	offset: number;
}

export interface LSFNode {
	name: string;
	attributes: Record<string, LSFAttribute>;
	children: LSFNode[];
}

export interface LSFAttribute {
	name: string;
	type: NodeAttributeType;
	value: any;
}
