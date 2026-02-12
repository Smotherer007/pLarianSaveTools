/**
 * DOS2 LSV Package Format Types
 * Based on Norbyte's LSLib (https://github.com/Norbyte/lslib)
 */

export const LSPK_SIGNATURE = 0x4b50534c; // "LSPK"

export enum CompressionMethod {
	None = 0,
	Zlib = 1,
	LZ4 = 2,
	Zstd = 3
}

export enum CompressionFlags {
	MethodNone = 0,
	MethodZlib = 1,
	MethodLZ4 = 2,
	MethodZstd = 3,
	FastCompress = 0x10,
	DefaultCompress = 0x20,
	MaxCompress = 0x40
}

export function getCompressionMethod(flags: number): CompressionMethod {
	return (flags & 0x0f) as CompressionMethod;
}

export interface PackagedFileInfo {
	name: string;
	archivePart: number;
	offsetInFile: bigint;
	sizeOnDisk: number;
	uncompressedSize: number;
	flags: number;
}

export interface PackageMetadata {
	version: number;
	fileListOffset: number;
	fileListSize: number;
	numParts: number;
	flags: number;
	numFiles: number;
}
