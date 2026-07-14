/**
 * Preload entry point: `node --import randspy/register app.js` (this is
 * what `randspy run` injects into the child it spawns).
 *
 * On load it reads its configuration from RANDSPY_OPTIONS (JSON), enables
 * a spy, and registers an exit hook that first disables every patch and
 * then either writes the JSON report to RANDSPY_REPORT_FILE (the CLI
 * contract) or, when used standalone, prints the text report to stderr so
 * it never mixes with the program's stdout.
 */
import fs from "node:fs";
import { renderText } from "./report.js";
import { RandSpy } from "./spy.js";

interface WireOptions {
  values?: boolean;
  internals?: boolean;
}

function readOptions(): WireOptions {
  const raw = process.env["RANDSPY_OPTIONS"];
  if (raw === undefined || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") return parsed as WireOptions;
  } catch {
    // A malformed option blob must never crash the traced program.
  }
  return {};
}

const options = readOptions();
const reportFile = process.env["RANDSPY_REPORT_FILE"];

const spy = new RandSpy({
  captureValues: options.values === true,
  includeInternals: options.internals === true,
});
spy.enable();

process.on("exit", () => {
  spy.disable();
  const report = spy.report();
  if (reportFile !== undefined && reportFile !== "") {
    try {
      fs.writeFileSync(reportFile, `${JSON.stringify(report)}\n`);
    } catch {
      // Losing the report is better than masking the program's own exit.
    }
  } else {
    fs.writeSync(2, `\n${renderText(report, { cwd: process.cwd() })}`);
  }
});
