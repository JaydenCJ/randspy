#!/usr/bin/env node
/**
 * The randspy CLI: `run` (trace a script in a child Node process via the
 * register preload), `report` (re-render a saved JSON report) and
 * `explain` (offline category documentation).
 *
 * Exit codes: 0 clean or gate not tripped, 1 entropy matched --fail-on,
 * 2 usage error. A non-zero child exit code is propagated unchanged so
 * randspy can wrap an existing test command without hiding its result.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FailGate } from "./report.js";
import {
  applyFilters,
  explainTopic,
  parseCategories,
  parseFailGate,
  renderJson,
  renderText,
  shouldFail,
} from "./report.js";
import type { Category, Report } from "./types.js";
import { VERSION } from "./version.js";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

const USAGE = `randspy ${VERSION} — trace Date, Math.random, env and iteration-order reads

Usage:
  randspy run [options] <script.js> [args...]   run a Node script under the tracer
  randspy report [options] <report.json>        render a saved JSON report
  randspy explain <topic>                       document a category offline
                                                (time | random | env | order | categories)
  randspy --version | --help

Options (run and report):
  --format <text|json>   output format (default: text)
  --only <cats>          keep only these categories, comma-separated
  --allow <pattern>      suppress sites matching a path glob, file:line or
                         API name; repeatable
  --fail-on <gate>       any | none | comma-separated categories (default: any)
  --top <n>              show only the n busiest sites in text output
  --quiet                summary and verdict only

Options (run only):
  --values               record up to 3 sample values per site (never env values)
  --internals            keep reads that never reach user code
  --report <file>        also write the raw JSON report to <file>

Exit codes:
  0  no traced read matched --fail-on
  1  the --fail-on gate tripped
  2  usage error (bad flag, unreadable report, unknown topic)
  A non-zero exit code from the traced script is propagated unchanged.
`;

interface Flags {
  format: "text" | "json";
  only?: Category[];
  allow: string[];
  failOn: FailGate;
  top?: number;
  quiet: boolean;
  values: boolean;
  internals: boolean;
  reportOut?: string;
  positionals: string[];
  /** For `run`: everything after the script token, passed to the child. */
  rest: string[];
}

class UsageError extends Error {}

function takeValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined) throw new UsageError(`${flag} requires a value`);
  return value;
}

/**
 * Parse flags for `run`/`report`. For `run`, flag parsing stops at the
 * first positional (the script) so the traced program's own flags pass
 * through untouched; `--` forces the stop earlier.
 */
function parseFlags(argv: string[], runMode: boolean): Flags {
  const flags: Flags = {
    format: "text",
    allow: [],
    failOn: "any",
    quiet: false,
    values: false,
    internals: false,
    positionals: [],
    rest: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      i += 1;
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      flags.positionals.push(arg);
      i += 1;
      if (runMode) break;
      continue;
    }
    switch (arg) {
      case "--format": {
        const value = takeValue(argv, i, arg);
        if (value !== "text" && value !== "json") {
          throw new UsageError(`--format must be "text" or "json", got "${value}"`);
        }
        flags.format = value;
        i += 2;
        break;
      }
      case "--only": {
        const cats = parseCategories(takeValue(argv, i, arg));
        if (cats === null) {
          throw new UsageError(`--only expects categories (time,random,env,order)`);
        }
        flags.only = cats;
        i += 2;
        break;
      }
      case "--allow": {
        flags.allow.push(takeValue(argv, i, arg));
        i += 2;
        break;
      }
      case "--fail-on": {
        const gate = parseFailGate(takeValue(argv, i, arg));
        if (gate === null) {
          throw new UsageError(`--fail-on expects any, none or categories (time,random,env,order)`);
        }
        flags.failOn = gate;
        i += 2;
        break;
      }
      case "--top": {
        const value = takeValue(argv, i, arg);
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new UsageError(`--top expects a non-negative integer, got "${value}"`);
        }
        flags.top = n;
        i += 2;
        break;
      }
      case "--quiet":
        flags.quiet = true;
        i += 1;
        break;
      case "--values":
        if (!runMode) throw new UsageError(`--values only applies to "randspy run"`);
        flags.values = true;
        i += 1;
        break;
      case "--internals":
        if (!runMode) throw new UsageError(`--internals only applies to "randspy run"`);
        flags.internals = true;
        i += 1;
        break;
      case "--report":
        if (!runMode) throw new UsageError(`--report only applies to "randspy run"`);
        flags.reportOut = takeValue(argv, i, arg);
        i += 2;
        break;
      default:
        throw new UsageError(`unknown flag "${arg}"`);
    }
  }
  // Everything left is positional; in run mode all tokens after the
  // script belong to the traced child, verbatim.
  for (; i < argv.length; i += 1) {
    if (runMode && flags.positionals.length >= 1) flags.rest.push(argv[i]!);
    else flags.positionals.push(argv[i]!);
  }
  return flags;
}

function renderAndGate(report: Report, flags: Flags): number {
  const filtered = applyFilters(report, {
    ...(flags.only !== undefined ? { only: flags.only } : {}),
    allow: flags.allow,
    cwd: process.cwd(),
  });
  const output =
    flags.format === "json"
      ? renderJson(filtered, { failOn: flags.failOn })
      : renderText(filtered, {
          failOn: flags.failOn,
          quiet: flags.quiet,
          cwd: process.cwd(),
          ...(flags.top !== undefined ? { top: flags.top } : {}),
        });
  process.stdout.write(output);
  return shouldFail(filtered, flags.failOn) ? 1 : 0;
}

function commandRun(argv: string[]): number {
  const flags = parseFlags(argv, true);
  const script = flags.positionals[0];
  if (script === undefined) {
    throw new UsageError(`"randspy run" needs a script to trace`);
  }
  const scriptPath = isAbsolute(script) ? script : resolve(process.cwd(), script);
  if (!fs.existsSync(scriptPath)) {
    throw new UsageError(`script not found: ${script}`);
  }

  const registerUrl = pathToFileURL(join(SELF_DIR, "register.js")).href;
  const workDir = fs.mkdtempSync(join(tmpdir(), "randspy-"));
  const reportFile = join(workDir, "report.json");
  try {
    const child = spawnSync(
      process.execPath,
      ["--import", registerUrl, scriptPath, ...flags.rest],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          RANDSPY_REPORT_FILE: reportFile,
          RANDSPY_OPTIONS: JSON.stringify({ values: flags.values, internals: flags.internals }),
        },
      }
    );
    if (child.error) {
      throw new UsageError(`could not spawn node: ${child.error.message}`);
    }
    if (!fs.existsSync(reportFile)) {
      process.stderr.write(
        `randspy: error: the traced process ended without writing a report (crash or signal ${child.signal ?? "?"})\n`
      );
      return child.status !== null && child.status !== 0 ? child.status : 1;
    }
    const report = readReport(reportFile);
    report.command = [script, ...flags.rest];
    if (flags.reportOut !== undefined) {
      try {
        fs.writeFileSync(flags.reportOut, `${JSON.stringify(report)}\n`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new UsageError(
          `cannot write report file ${flags.reportOut} (${reason}) — does the directory exist?`
        );
      }
    }
    process.stdout.write("\n");
    const gate = renderAndGate(report, flags);
    if (child.status !== null && child.status !== 0) return child.status;
    if (child.signal !== null) return 1;
    return gate;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function readReport(path: string): Report {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    throw new UsageError(`cannot read report file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`${path} is not valid JSON`);
  }
  const report = parsed as Report;
  if (
    report === null ||
    typeof report !== "object" ||
    report.tool !== "randspy" ||
    report.schema !== 1 ||
    !Array.isArray(report.records)
  ) {
    throw new UsageError(`${path} is not a randspy report (schema 1)`);
  }
  return report;
}

function commandReport(argv: string[]): number {
  const flags = parseFlags(argv, false);
  const file = flags.positionals[0];
  if (file === undefined) throw new UsageError(`"randspy report" needs a report file`);
  if (flags.positionals.length > 1) {
    throw new UsageError(`"randspy report" takes exactly one report file`);
  }
  return renderAndGate(readReport(file), flags);
}

function commandExplain(argv: string[]): number {
  const topic = argv[0];
  if (topic === undefined) {
    throw new UsageError(`"randspy explain" needs a topic (time|random|env|order|categories)`);
  }
  const text = explainTopic(topic);
  if (text === null) {
    throw new UsageError(`unknown topic "${topic}" — try time, random, env, order or categories`);
  }
  process.stdout.write(text);
  return 0;
}

export function main(argv: string[]): number {
  try {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (command === "--version" || command === "-v") {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    switch (command) {
      case "run":
        return commandRun(argv.slice(1));
      case "report":
        return commandReport(argv.slice(1));
      case "explain":
        return commandExplain(argv.slice(1));
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`randspy: error: ${err.message}\n`);
      process.stderr.write(`run "randspy --help" for usage\n`);
      return 2;
    }
    throw err;
  }
}

// A downstream pipe that closes early (`randspy run … | head`) must not
// crash the CLI with an unhandled EPIPE: keep whatever exit code was
// already decided and stop writing.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: Error & { code?: string }) => {
    if (err.code === "EPIPE") {
      process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
    }
    throw err;
  });
}

process.exitCode = main(process.argv.slice(2));
