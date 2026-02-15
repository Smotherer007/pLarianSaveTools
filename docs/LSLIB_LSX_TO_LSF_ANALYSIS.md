# LSLib: LSX → LSF Konvertierung – Analyse

Schritt-für-Schritt-Analyse von LSLib und DoS-2-Savegame-Editor.

## 1. Ablauf in LSLib

### ResourceUtils.cs – zentraler Einstieg

```
LoadResource(path, format)  →  LSXReader / LSFReader  →  Resource (in-memory)
SaveResource(resource, path, format)  →  LSFWriter  →  LSF-Datei
```

**LSX → LSF:** `LoadResource(lsxPath, LSX)` → `SaveResource(resource, lsfPath, LSF)`

### ResourceConversionParameters (Standard)

- `LSFVersion` = MaxWriteVersion (vom Spiel)
- `MetadataFormat` = None oder aus Resource
- `Compression` = None (Default!) – kann überschrieben werden
- `CompressionLevel` = Default (= L10_OPT für LZ4)

---

## 2. LSFWriter – Schreibablauf

### Reihenfolge der Blöcke

1. **WriteRegions** – iteriert über `resource.Regions` (Dictionary-Reihenfolge)
2. **WriteNodeV2** / **WriteNodeV3** – je nach Version
3. **WriteNodeAttributesV2** – `foreach (KeyValuePair entry in node.Attributes)` → **Dictionary-Reihenfolge**
4. **WriteNodeChildren** – Kinder werden nach Eltern geschrieben

### Kompression (Compression.cs)

```csharp
// LZ4 mit K4os.Compression.LZ4
LSCompressionLevel.Default → LZ4Level.L10_OPT
LZ4Codec.Encode(uncompressed, compressed, level)
```

- **Chunked** (VerChunkedCompress+): nodes, attrs, values als LZ4-Stream mit `LZ4Stream.Encode`
- **Nicht-chunked**: Einzelblöcke mit `LZ4Codec.Encode`

### Attribut-Serialisierung (BinUtils.WriteAttribute)

```csharp
case AttributeType.Bool:
    writer.Write((Byte)((Boolean)attr.Value ? 1 : 0));  // Immer 0 oder 1
```

### String-Tabelle

- `String.GetHashCode()` (.NET Framework-Stil)
- Bucket: `(hash & 0x1ff) ^ ((hash>>9) & 0x1ff) ^ ((hash>>18) & 0x1ff) ^ ((hash>>27) & 0x1ff)`
- Format: 512 Buckets, pro Bucket `(bucket<<16)|offset`

---

## 3. DoS-2-Savegame-Editor

- **Nutzt LSLib direkt** – keine LSX-Konvertierung
- Bearbeitet `Resource` im Speicher
- Schreibt mit `LSFWriter` zurück
- Kein LSX-Zwischenschritt

---

## 4. Unterschiede zu unserem pLarianSaveTools

| Aspekt | LSLib | pLarianSaveTools |
|--------|-------|------------------|
| **LZ4** | K4os.LZ4, Level L10_OPT | npm lz4, encodeBlockHC (Level 9 default) |
| **Bool** | 0 oder 1 | 0 oder 1 (gleich) |
| **Attribut-Reihenfolge** | Dictionary-Reihenfolge (LSLib-Order) | Pre-Order (V13) oder LSLib-Order |
| **String-Hash** | .NET GetHashCode | dotNetStringHashCode (nachgebaut) |
| **MetadataFormat** | None / KeysAndAdjacency | 0 (V2) für DOS2 |
| **Chunked** | VerChunkedCompress+ | Nein (einzelne Blöcke) |

---

## 5. Mögliche Ursachen für DOS2-Ablehnung

1. **LZ4-Kompression** – andere Bytes als LSLib/K4os
2. **Chunked vs. non-chunked** – DOS2 könnte chunked LZ4 erwarten
3. **MetadataFormat** – V2 vs. V3 (KeysAndAdjacency)
4. **Attribut-Reihenfolge** – andere Reihenfolge als im Original
5. **Node-Reihenfolge** – Region/Children-Traversierung

---

## 6. LSFVersion und Chunked-Kompression

```
VerInitial = 0x01
VerChunkedCompress = 0x02   ← Ab hier: chunked LZ4 für nodes/attrs/values
VerExtendedNodes = 0x03     ← DOS2 nutzt diese Version
...
```

**DOS2 nutzt Version 3** → `Version >= VerChunkedCompress` (0x02) → **chunked = true**

LSLib komprimiert nodes, attrs, values mit `LZ4Stream.Encode` (chunked = LZ4-Frame-Format).
Wir nutzen `encodeBlock` / `encodeBlockHC` (einzelne Blöcke, kein Frame).

→ **Möglicherweise falsches Kompressionsformat**: LZ4-Frame vs. LZ4-Block.

---

## 7. Implementierung (erledigt)

**Chunked LZ4** wurde implementiert:
- **Strings:** LZ4-Block (wie LSLib, allowChunked=false)
- **Nodes, Attrs, Values:** LZ4-Frame mit `lz4.encode()`:
  - blockIndependence: false
  - blockMaxSize: 64KB
  - highCompression: true

Roundtrip: 2180 → 2179 B (1 B Differenz, vermutlich Strings-Kompression).

## 8. Empfehlungen

1. **In DOS2 testen** – ob die gepackte LSV mit LSX-Änderungen akzeptiert wird
2. **Patch-Workflow** – falls weiterhin Probleme: Original-LSF in-place patchen
