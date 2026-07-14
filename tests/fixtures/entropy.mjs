// Fixture: exactly one read from each of the four categories, no output
// on stdout, exit 0 — so CLI tests can parse the report cleanly and
// assert precise counts.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();
const roll = Math.random();
const shell = process.env.SHELL ?? "";
const here = fileURLToPath(new URL(".", import.meta.url));
const entries = fs.readdirSync(here);

// Keep every value alive so nothing is optimized away.
if (startedAt < 0 || roll < 0 || shell.length < 0 || entries.length < 0) {
  throw new Error("unreachable");
}
