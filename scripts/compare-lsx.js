#!/usr/bin/env node
/**
 * Vergleicht zwei LSX-Dateien mit diff-js-xml
 * Nutzung: node scripts/compare-lsx.js <original.lsx> <roundtrip.lsx>
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tool = require("diff-js-xml");

const [origPath, roundPath] = process.argv.slice(2);
if (!origPath || !roundPath) {
  console.error("Nutzung: node scripts/compare-lsx.js <original.lsx> <roundtrip.lsx>");
  process.exit(1);
}

const orig = readFileSync(origPath, "utf8");
const round = readFileSync(roundPath, "utf8");

console.log("Original:", origPath, "-", orig.length, "Zeichen");
console.log("Roundtrip:", roundPath, "-", round.length, "Zeichen");
console.log("\nVergleiche... (kann bei großen Dateien dauern)\n");

tool.diffAsXml(orig, round, null, { compareElementValues: true }, (result) => {
  if (result.length === 0) {
    console.log("Keine Unterschiede gefunden (semantisch identisch).");
    process.exit(0);
  }
  console.log("Gefundene Unterschiede:", result.length);
  console.log("\nErste 50 Unterschiede:\n");
  for (let i = 0; i < Math.min(50, result.length); i++) {
    console.log(`${i + 1}. [${result[i].type}] ${result[i].path}`);
    if (result[i].message) console.log("   ", result[i].message);
  }
  if (result.length > 50) {
    console.log("\n... und", result.length - 50, "weitere.");
  }
  process.exit(1);
});
