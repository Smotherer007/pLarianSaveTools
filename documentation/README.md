# Projekt-Dokumentation: Diagramme

Diese Seite enthält die visuellen Darstellungen der Projekt-Architektur und der Workflows.

## Kern-Architektur

Diese Grafik zeigt das Zusammenspiel der verschiedenen Dateiformate und der internen Verarbeitungslogik.

```mermaid
graph TD
    LSV[".lsv (Package File)"] <--> |Unpacker / Packer| LSF[".lsf (Binary Meta/Save)"]
    LSF <--> |Reader / Writer| NodeTree["In-Memory Node Tree"]
    NodeTree <--> |LSX Writer / Reader| LSX[".lsx (Readable XML)"]
    
    subgraph "Compression Layer"
        LZ4[LZ4]
        Zstd[Zstd]
        Zlib[Zlib]
    end
    
    LSV --- LZ4
    LSV --- Zstd
    LSF --- Zlib
```

## Workflow: Extraktion und Repacking

Der typische Ablauf, um ein Savegame zu editieren.

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant LSV as LSV Module
    participant LSF as LSF Module
    participant LSX as LSX Module

    User->>CLI: node cli.js extract-lsx save.lsv
    CLI->>LSV: Entpacken
    LSV->>LSF: LSF Binärdaten extrahieren
    LSF->>LSX: In XML konvertieren
    LSX-->>User: ./extracted/meta.lsx (Editierbar)
    
    Note over User: User editiert die XML Datei
    
    User->>CLI: node cli.js pack-lsx ./extracted
    CLI->>LSX: XML einlesen
    LSX->>LSF: Binärdaten generieren
    LSF->>LSV: In .lsv Paket packen
    LSV-->>User: repacked.lsv
```
