# DOS2 & BG3 Savegame Tools

A tool to unpack, edit, and repack savegame files from **Divinity Original Sin 2** and **Baldur's Gate 3**.

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

### Extract LSV directly to LSX

Use `extract-lsx` to unpack an LSV file and convert all LSF files to LSX in one step. The output folder will contain only LSX files (no LSF files).

### Repack a savegame

**Pack (LSF-Dateien):** Scannt das Verzeichnis und packt alle Dateien mit Zlib (wie [Divine](https://github.com/fireundubh/divine)).

**Pack-LSX (LSX-Dateien):** Scannt das Verzeichnis, konvertiert LSX→LSF und packt alles.

### Convert LSF to LSX (for editing)

LSF files are binary and hard to read. After converting to LSX you can edit them with a text editor. You can then convert them back to LSF.

### Command reference

| Action                            | Command                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| Unpack                            | `node dist/cli.js unpack file.lsv target-folder`            |
| **LSV → LSX (+ PNG etc.)**        | `node dist/cli.js extract-lsx file.lsv target-folder`      |
| Repack                            | `node dist/cli.js pack source-folder output.lsv`            |
| LSF → LSX                         | `node dist/cli.js convert file.lsf file.lsx`                |
| LSX → LSF                         | `node dist/cli.js convert file.lsx file.lsf`                |

### Help

Use `help` or `--help` to see an overview of all commands.

## Supported games

- **Divinity Original Sin 2** (DOS2)
- **Baldur's Gate 3** (BG3)

## License

Apache License 2.0 – siehe [LICENSE](LICENSE) für Details.
