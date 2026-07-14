/**
 * Shared types for randspy: entropy categories, raw spy events, aggregated
 * site records and the JSON report shape. Everything downstream (spy,
 * aggregation, rendering, CLI) speaks these types; none of them touch
 * process state.
 */

/** The four classes of nondeterminism randspy traces. */
export type Category = "time" | "random" | "env" | "order";

/** Canonical category order, used for summaries, hints and sorting ties. */
export const CATEGORIES: readonly Category[] = ["time", "random", "env", "order"];

/** A resolved source position: absolute file path plus 1-based line/column. */
export interface Site {
  file: string;
  line: number;
  column: number;
}

/** One recorded read of an entropy source, before aggregation. */
export interface SpyEvent {
  category: Category;
  /** Human-readable API name, e.g. `Math.random()` or `process.env.TZ`. */
  api: string;
  site: Site;
  /**
   * True when the read never crossed user code (only `node:` internal
   * frames above the tracer). Such events are dropped unless the spy is
   * created with `includeInternals: true`.
   */
  internal: boolean;
  /** Stringified sample value, present only with `captureValues: true`. */
  sample?: string;
}

/** Aggregated reads: one row per (category, api, exact source position). */
export interface SiteRecord {
  category: Category;
  api: string;
  file: string;
  line: number;
  column: number;
  count: number;
  internal: boolean;
  samples?: string[];
}

/** Per-category read totals plus overall counts. */
export interface ReportSummary {
  reads: number;
  sites: number;
  byCategory: Record<Category, number>;
}

/** The stable JSON report shape (documented in docs/report-format.md). */
export interface Report {
  tool: "randspy";
  schema: 1;
  version: string;
  /** The traced command, set by `randspy run`; absent for library use. */
  command?: string[];
  summary: ReportSummary;
  records: SiteRecord[];
}

/** Options accepted by `new RandSpy(...)` and `randspy run` (via env). */
export interface SpyOptions {
  /** Record up to `maxSamples` stringified return values per site. Env
   * variable *values* are never captured, only names. Default false. */
  captureValues?: boolean;
  /** Keep reads whose stack never reaches user code. Default false. */
  includeInternals?: boolean;
  /** Cap on stored samples per site when `captureValues` is on. Default 3. */
  maxSamples?: number;
  /** Extra path substrings treated as tracer-internal when resolving the
   * call site (useful for wrapping helpers of your own). Default []. */
  skipFiles?: string[];
}
