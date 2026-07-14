/**
 * Report filtering and rendering: the `--only` / `--allow` / `--top`
 * filters, the human text renderer, the stable JSON renderer, the
 * fail-on gate, per-category remediation hints and the offline
 * `explain` texts. Pure functions — the CLI is the only caller that
 * touches process state.
 */
import { summarize } from "./aggregate.js";
import { matchGlob } from "./match.js";
import type { Category, Report, SiteRecord } from "./types.js";
import { CATEGORIES } from "./types.js";

/** `--fail-on` gate: everything, nothing, or a set of categories. */
export type FailGate = "any" | "none" | Category[];

/** One-line remediation hint per category, appended under the site table. */
export const HINTS: Record<Category, string> = {
  time: "freeze the clock — mock timers (node:test, jest, vitest) or an injected now() keep runs reproducible",
  random: "inject a seeded PRNG, or stub Math.random / crypto in test setup",
  env: "pass required variables explicitly in test setup instead of reading the ambient environment",
  order: "sort directory listings before iterating — readdir order is filesystem-dependent",
};

const LABELS: Record<Category, string> = {
  time: "TIME",
  random: "RANDOM",
  env: "ENV",
  order: "ORDER",
};

/** Parse a `--fail-on` value; null on anything unknown. */
export function parseFailGate(raw: string): FailGate | null {
  if (raw === "any" || raw === "none") return raw;
  const cats = parseCategories(raw);
  return cats;
}

/** Parse a comma-separated category list; null when any entry is unknown. */
export function parseCategories(raw: string): Category[] | null {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const seen: Category[] = [];
  for (const part of parts) {
    if (!(CATEGORIES as readonly string[]).includes(part)) return null;
    if (!seen.includes(part as Category)) seen.push(part as Category);
  }
  return seen;
}

/** Make a site path readable: relative to `cwd` when underneath it. */
export function relativize(file: string, cwd: string): string {
  if (cwd.length === 0) return file;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * True when an `--allow` pattern suppresses this record. Patterns match,
 * in order: the exact API name (`Math.random()`), an API glob when the
 * pattern has no slash (`process.env.*`), the cwd-relative file path
 * (`tests/**`), that path with `:line` appended (`src/id.js:14`), and —
 * for slash-free patterns — the file's basename (`*.test.js`).
 */
export function isAllowed(rec: SiteRecord, patterns: readonly string[], cwd: string): boolean {
  const rel = relativize(rec.file, cwd);
  for (const pattern of patterns) {
    if (pattern === rec.api) return true;
    if (!pattern.includes("/") && matchGlob(pattern, rec.api)) return true;
    if (matchGlob(pattern, rel)) return true;
    if (matchGlob(pattern, `${rel}:${rec.line}`)) return true;
    if (!pattern.includes("/") && matchGlob(pattern, basenameOf(rel))) return true;
  }
  return false;
}

export interface FilterOptions {
  only?: Category[];
  allow?: string[];
  cwd?: string;
}

/** Apply `--only` / `--allow` and recompute the summary over what is left. */
export function applyFilters(report: Report, opts: FilterOptions): Report {
  let records = report.records;
  const only = opts.only;
  if (only && only.length > 0) {
    records = records.filter((r) => only.includes(r.category));
  }
  const allow = opts.allow;
  if (allow && allow.length > 0) {
    const cwd = opts.cwd ?? "";
    records = records.filter((r) => !isAllowed(r, allow, cwd));
  }
  return { ...report, records, summary: summarize(records) };
}

/** The gate decision behind exit code 1. */
export function shouldFail(report: Report, gate: FailGate): boolean {
  if (gate === "none") return false;
  if (gate === "any") return report.summary.reads > 0;
  return report.records.some((r) => gate.includes(r.category));
}

function gateText(gate: FailGate): string {
  return typeof gate === "string" ? gate : gate.join(",");
}

function matchedReads(report: Report, gate: FailGate): number {
  if (gate === "any") return report.summary.reads;
  if (gate === "none") return 0;
  let n = 0;
  for (const cat of gate) n += report.summary.byCategory[cat];
  return n;
}

export interface RenderOptions {
  /** When set, a final verdict line (OK/FAIL) is appended. */
  failOn?: FailGate;
  /** Show only the N busiest sites; 0 or undefined means all. */
  top?: number;
  /** Header and verdict only. */
  quiet?: boolean;
  /** Base for relativizing site paths. Default: no relativizing. */
  cwd?: string;
}

function headerLine(report: Report): string {
  const { reads, sites, byCategory } = report.summary;
  if (reads === 0) return "randspy: no nondeterministic reads detected";
  const parts = CATEGORIES.filter((c) => byCategory[c] > 0).map((c) => `${c} ${byCategory[c]}`);
  return `randspy: ${reads} nondeterministic read(s) from ${sites} site(s) — ${parts.join(" · ")}`;
}

function verdictLine(report: Report, gate: FailGate): string {
  const g = gateText(gate);
  if (shouldFail(report, gate)) {
    return `randspy: FAIL — ${matchedReads(report, gate)} read(s) match fail-on=${g}`;
  }
  if (report.summary.reads > 0) {
    return `randspy: OK — ${report.summary.reads} read(s) traced, none match fail-on=${g}`;
  }
  return `randspy: OK — no nondeterministic reads (fail-on=${g})`;
}

/** Render the human-readable text report. Deterministic for equal input. */
export function renderText(report: Report, opts: RenderOptions = {}): string {
  const lines: string[] = [headerLine(report)];
  const records = report.records;
  const top = opts.top !== undefined && opts.top > 0 ? opts.top : records.length;
  const shown = records.slice(0, top);

  if (!opts.quiet && shown.length > 0) {
    lines.push("");
    const countWidth = Math.max(...shown.map((r) => `×${r.count}`.length));
    const apiWidth = Math.max(...shown.map((r) => r.api.length));
    for (const rec of shown) {
      const label = LABELS[rec.category].padEnd(6);
      const count = `×${rec.count}`.padStart(countWidth);
      const api = rec.api.padEnd(apiWidth);
      const site = `${relativize(rec.file, opts.cwd ?? "")}:${rec.line}:${rec.column}`;
      const internal = rec.internal ? "  (node internals)" : "";
      lines.push(`  ${label}  ${count}  ${api}  ${site}${internal}`);
      if (rec.samples && rec.samples.length > 0) {
        lines.push(`${" ".repeat(12 + countWidth)}samples: ${rec.samples.join(", ")}`);
      }
    }
    if (records.length > shown.length) {
      lines.push(`  ... ${records.length - shown.length} more site(s) — rerun without --top to see all`);
    }
    const present = CATEGORIES.filter((c) => shown.some((r) => r.category === c));
    if (present.length > 0) {
      lines.push("");
      for (const cat of present) lines.push(`  hint(${cat}): ${HINTS[cat]}`);
    }
  }

  if (opts.failOn !== undefined) {
    lines.push("");
    lines.push(verdictLine(report, opts.failOn));
  }
  return `${lines.join("\n")}\n`;
}

/** Render the stable JSON shape; `ok` is included only when gated. */
export function renderJson(report: Report, opts: { failOn?: FailGate } = {}): string {
  const out: Record<string, unknown> = {
    tool: report.tool,
    schema: report.schema,
    version: report.version,
  };
  if (report.command !== undefined) out["command"] = report.command;
  if (opts.failOn !== undefined) {
    out["failOn"] = gateText(opts.failOn);
    out["ok"] = !shouldFail(report, opts.failOn);
  }
  out["summary"] = report.summary;
  out["records"] = report.records;
  return `${JSON.stringify(out, null, 2)}\n`;
}

const EXPLAIN: Record<string, string> = {
  time: [
    "time — wall-clock and monotonic-clock reads",
    "",
    "Traced APIs: Date.now(), new Date() with no arguments, legacy Date()",
    "calls, performance.now(), process.hrtime() and process.hrtime.bigint().",
    "",
    "Why it flakes: assertions on timestamps, TTLs, snapshot objects that",
    "embed 'createdAt', or code that branches on elapsed time all change",
    "between runs — and between fast CI machines and slow laptops.",
    "",
    "Fix: freeze the clock with your runner's mock timers, or refactor the",
    "code under test to take a now() function so tests can inject one.",
    "Suppress a reviewed site with --allow 'src/telemetry.js:12'.",
  ].join("\n"),
  random: [
    "random — pseudo-random and cryptographic randomness",
    "",
    "Traced APIs: Math.random(), crypto.randomBytes(), crypto.randomInt(),",
    "crypto.randomUUID(), crypto.randomFillSync() and",
    "crypto.getRandomValues() (both node:crypto and globalThis.crypto).",
    "",
    "Why it flakes: generated ids leak into snapshots, retry jitter changes",
    "timing-sensitive paths, and property-style tests without a fixed seed",
    "fail on inputs you cannot reproduce.",
    "",
    "Fix: inject a seeded PRNG (e.g. mulberry32) and stub uuid generation.",
    "Suppress a reviewed site with --allow 'Math.random()' or a path glob.",
  ].join("\n"),
  env: [
    "env — ambient process environment reads",
    "",
    "Traced APIs: property reads and 'in' checks on process.env (reported",
    "as process.env.NAME), plus whole-environment enumeration such as",
    "Object.keys(process.env), reported as 'process.env (enumerate)'.",
    "Variable names are recorded; values never are.",
    "",
    "Why it flakes: TZ, LANG, CI, HOME and half-remembered feature flags",
    "differ across machines, so a test can only pass on the machine that",
    "happens to have the right shell profile.",
    "",
    "Fix: read configuration once at an explicit boundary and pass it in;",
    "in tests, set the variables you depend on. RANDSPY_* reads are ignored.",
  ].join("\n"),
  order: [
    "order — filesystem iteration order",
    "",
    "Traced APIs: fs.readdirSync(), callback fs.readdir() and",
    "fs.promises.readdir().",
    "",
    "Why it flakes: readdir order is not guaranteed — it differs across",
    "filesystems and platforms, so 'the first fixture file' or a snapshot",
    "of a concatenation is a different value on another machine.",
    "",
    "Fix: sort the listing before use (entries.sort()). If order is truly",
    "irrelevant downstream, suppress the site with --allow after review.",
    "Note: named ESM imports of fs bind early and are not traced; import",
    "the default object (import fs from 'node:fs') to keep reads visible.",
  ].join("\n"),
  categories: [
    "randspy traces four categories of nondeterminism:",
    "",
    "  time    Date.now, new Date(), Date(), performance.now, process.hrtime",
    "  random  Math.random, crypto.randomBytes/Int/UUID/FillSync/getRandomValues",
    "  env     process.env property reads, 'in' checks and enumeration",
    "  order   fs.readdirSync / fs.readdir / fs.promises.readdir",
    "",
    "Run `randspy explain <category>` for traced APIs, failure modes and fixes.",
  ].join("\n"),
};

/** Offline documentation for `randspy explain`; null for unknown topics. */
export function explainTopic(topic: string): string | null {
  const text = EXPLAIN[topic];
  return text === undefined ? null : `${text}\n`;
}
