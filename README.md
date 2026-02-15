# DOS2 Savegame Tools

A tool to unpack, edit, and repack savegame files from **Divinity Original Sin 2**.

## What can you do with it?

- **Unpack savegames** – Extract LSV files into individual files
- **Edit files** – Convert LSF files to readable XML (LSX) and back
- **Repack savegames** – Combine edited files back into a single LSV file

## Requirements

You need **Node.js** (version 18 or higher).  
If not installed yet: [nodejs.org](https://nodejs.org)

## Installation

1. Download or clone this folder
2. Open a terminal and navigate to the folder
3. Run `npm install`
4. Run `npm run build`

## Usage

All commands are run in the terminal. Each command starts with `node dist/cli.js` followed by the command.

### Unpack a savegame

Create a target folder and unpack the LSV file into it.

```bash
node dist/cli.js unpack Kiss.lsv ./extracted
```

### Extract LSV directly to LSX

Use `extract-lsx` to unpack an LSV file and convert all LSF files to LSX in one step. The output folder will contain only LSX files (no LSF files).

```bash
node dist/cli.js extract-lsx Kiss.lsv ./lsx-only
```

### Patch-Workflow (einzelne Dateien bearbeiten)

Zum gezielten Bearbeiten einzelner Dateien (z.B. nur `meta` für Difficulty) ohne vollständige Re-Serialisierung:

1. **Unpack** – LSV entpacken (LSF-Dateien)
   ```bash
   node dist/cli.js unpack Kiss.lsv ./extracted
   ```

2. **Convert** – nur die zu bearbeitende Datei zu LSX konvertieren (erzeugt `.offsets.json` für den Patch)
   ```bash
   node dist/cli.js convert ./extracted/meta.lsf ./extracted/meta.lsx
   ```

3. **Bearbeiten** – `meta.lsx` im Texteditor öffnen und ändern (z.B. Difficulty, Spielername)

4. **Pack** – Ordner zurück packen (nutzt Patch: nur geänderte Werte werden injiziert)
   ```bash
   node dist/cli.js pack-lsx ./extracted Kiss_repacked.lsv
   ```

5. **Optional: Aufräumen** – LSX und Offsets nach dem Packen löschen
   ```bash
   node dist/cli.js pack-lsx ./extracted Kiss_repacked.lsv --cleanup
   ```

**Alternative: Nur LSF patchen (ohne LSV neu zu packen)** – Änderungen aus LSX direkt in die LSF überführen:
```bash
node dist/cli.js patch ./extracted/meta.lsx --cleanup
# oder alle LSX im Ordner:
node dist/cli.js patch ./extracted --cleanup
```

### Repack a savegame

**Pack (LSF-Dateien):** Scannt das Verzeichnis und packt alle Dateien mit Zlib (wie [Divine](https://github.com/fireundubh/divine)).

**Pack-LSX (LSX-Dateien):** Scannt das Verzeichnis, konvertiert LSX→LSF und packt alles. Bei vorhandenen `.offsets.json` wird ein Patch durchgeführt (minimale Änderungen).

### Convert LSF to LSX (for editing)

LSF files are binary and hard to read. After converting to LSX you can edit them with a text editor. Bei LSF→LSX werden zusätzlich `.offsets.json` erzeugt (für den Patch-Workflow).

### Schneller Patch-Test

Zum schnellen Testen von LSX-Änderungen im Spiel (ohne jedes Mal volles pack-lsx):

```bash
# Einmalig: LSV extrahieren
node dist/cli.js extract-lsx QuickSave_14.lsv ./extracted

# meta.lsx bearbeiten, dann:
npm run test:patch -- --dir ./extracted
# → erzeugt QuickSave_14_patch_test.lsv (nur patch + pack, sehr schnell)
```

Oder alles in einem Durchlauf: `npm run test:patch` (mit QuickSave_14.lsv im Projektordner).

### Command reference

| Action                            | Command                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| Unpack                            | `node dist/cli.js unpack file.lsv target-folder`                     |
| **LSV → LSX (+ PNG etc.)**        | `node dist/cli.js extract-lsx file.lsv target-folder`               |
| Repack (LSX)                      | `node dist/cli.js pack-lsx source-folder output.lsv`                  |
| Repack (LSX) + Aufräumen         | `node dist/cli.js pack-lsx source-folder output.lsv --cleanup`       |
| Repack (LSF)                      | `node dist/cli.js pack source-folder output.lsv`                      |
| **LSX → LSF patchen**             | `node dist/cli.js patch file.lsx [--cleanup]`                         |
| **LSX → LSF patchen (Ordner)**    | `node dist/cli.js patch folder [--cleanup]`                           |
| LSF → LSX                         | `node dist/cli.js convert file.lsf file.lsx`                          |
| LSX → LSF                         | `node dist/cli.js convert file.lsx file.lsf`                         |

### Help

Use `help` or `--help` to see an overview of all commands.

## Supported games

- **Divinity Original Sin 2** (DOS2)

## License

Apache License 2.0 – siehe [LICENSE](LICENSE) für Details.
