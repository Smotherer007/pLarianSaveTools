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

### Patch workflow (edit individual files)

To edit specific files (e.g. only `meta` for Difficulty) without full re-serialization:

1. **Unpack** – Extract LSV (LSF files)
   ```bash
   node dist/cli.js unpack Kiss.lsv ./extracted
   ```

2. **Convert** – Convert only the file to edit to LSX (creates `.offsets.json` for patching)
   ```bash
   node dist/cli.js convert ./extracted/meta.lsf ./extracted/meta.lsx
   ```

3. **Edit** – Open `meta.lsx` in a text editor and modify (e.g. Difficulty, player name)

4. **Pack** – Repack the folder (uses patch: only changed values are injected)
   ```bash
   node dist/cli.js pack-lsx ./extracted Kiss_repacked.lsv
   ```

5. **Optional: Cleanup** – Remove LSX and offsets after packing
   ```bash
   node dist/cli.js pack-lsx ./extracted Kiss_repacked.lsv --cleanup
   ```

**Alternative: Patch LSF only (without repacking LSV)** – Apply LSX changes directly to LSF:
```bash
node dist/cli.js patch ./extracted/meta.lsx --cleanup
# or all LSX in folder:
node dist/cli.js patch ./extracted --cleanup
```

### Repack a savegame

**Pack (LSF files):** Scans the directory and packs all files with Zlib (like [Divine](https://github.com/fireundubh/divine)).

**Pack-LSX (LSX files):** Scans the directory, converts LSX→LSF and packs everything. With `.offsets.json` present, a patch is applied (minimal changes).

### Convert LSF to LSX (for editing)

LSF files are binary and hard to read. After converting to LSX you can edit them with a text editor. LSF→LSX also creates `.offsets.json` (for the patch workflow).

### Quick patch test

To quickly test LSX changes in-game (without full pack-lsx each time):

```bash
# One-time: extract LSV
node dist/cli.js extract-lsx QuickSave_14.lsv ./extracted

# Edit meta.lsx, then:
npm run test:patch -- --dir ./extracted
# → creates QuickSave_14_patch_test.lsv (patch + pack only, very fast)
```

Or run everything at once: `npm run test:patch` (with QuickSave_14.lsv in project folder).

### Command reference

| Action                            | Command                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| Unpack                            | `node dist/cli.js unpack file.lsv target-folder`                     |
| **LSV → LSX (+ PNG etc.)**        | `node dist/cli.js extract-lsx file.lsv target-folder`               |
| Repack (LSX)                      | `node dist/cli.js pack-lsx source-folder output.lsv`                  |
| Repack (LSX) + cleanup           | `node dist/cli.js pack-lsx source-folder output.lsv --cleanup`       |
| Repack (LSF)                      | `node dist/cli.js pack source-folder output.lsv`                      |
| **LSX → LSF patch**               | `node dist/cli.js patch file.lsx [--cleanup]`                         |
| **LSX → LSF patch (folder)**     | `node dist/cli.js patch folder [--cleanup]`                           |
| **Patch single value**           | `node dist/cli.js patch-value file.lsf <path> <value>`               |
| **Read value**                   | `node dist/cli.js get-value file.lsf <path>`                         |
| LSF → LSX                         | `node dist/cli.js convert file.lsf file.lsx`                          |
| **Offsets only**                 | `node dist/cli.js convert file.lsf --offsets-only`                  |
| LSX → LSF                         | `node dist/cli.js convert file.lsx file.lsf`                         |

### Read/patch single value (for API/frontend)

Without parsing LSX – use path directly. Paths from `.offsets.json`:

```bash
# Create offsets only (fast, no LSX)
node dist/cli.js convert meta.lsf --offsets-only

# Read value
node dist/cli.js get-value meta.lsf MetaData/MetaData/Difficulty

# Patch value
node dist/cli.js patch-value meta.lsf MetaData/MetaData/Difficulty 2
```

Programmatic usage:

```ts
import { getLsfValue, getLsfValueAtOffset, patchLsfValue, patchLsfAtOffset } from "dos2-savegame-tools";

// Read value
const value = getLsfValue(lsfBuffer, offsetMap, "MetaData/MetaData/Difficulty");

// Patch value
const patched = patchLsfValue(lsfBuffer, offsetMap, "MetaData/MetaData/Difficulty", 2);

// With raw offset (when offset/length/type known)
const value = getLsfValueAtOffset(lsfBuffer, offset, length, type);
const patched = patchLsfAtOffset(lsfBuffer, offset, length, type, value);
```

### Help

Use `help` or `--help` to see an overview of all commands.

## Supported games

- **Divinity Original Sin 2** (DOS2)

## License

Apache License 2.0 – see [LICENSE](LICENSE) for details.
