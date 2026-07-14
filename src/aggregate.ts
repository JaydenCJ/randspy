/**
 * Event aggregation: fold the raw read-event stream into one record per
 * (category, api, exact source position), count reads, cap samples and
 * sort deterministically. Pure functions over values — the same events
 * always produce byte-identical reports.
 */
import type { Category, Report, ReportSummary, SiteRecord, SpyEvent } from "./types.js";

// NUL never appears in file paths or API names, so grouping keys cannot collide.
const KEY_SEP = String.fromCharCode(0);

/** Busiest sites first; ties break on file, line, column, then api. */
export function compareRecords(a: SiteRecord, b: SiteRecord): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (a.api !== b.api) return a.api < b.api ? -1 : 1;
  return 0;
}

/** Group events into sorted site records. `maxSamples` caps stored values. */
export function aggregate(events: readonly SpyEvent[], maxSamples = 3): SiteRecord[] {
  const byKey = new Map<string, SiteRecord>();
  for (const ev of events) {
    const key = [ev.category, ev.api, ev.site.file, ev.site.line, ev.site.column].join(KEY_SEP);
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        category: ev.category,
        api: ev.api,
        file: ev.site.file,
        line: ev.site.line,
        column: ev.site.column,
        count: 0,
        internal: ev.internal,
      };
      byKey.set(key, rec);
    }
    rec.count += 1;
    if (ev.sample !== undefined && maxSamples > 0) {
      if (!rec.samples) rec.samples = [];
      if (rec.samples.length < maxSamples) rec.samples.push(ev.sample);
    }
  }
  const records = [...byKey.values()];
  records.sort(compareRecords);
  return records;
}

/** Totals for the header line and the JSON `summary` object. */
export function summarize(records: readonly SiteRecord[]): ReportSummary {
  const byCategory: Record<Category, number> = { time: 0, random: 0, env: 0, order: 0 };
  let reads = 0;
  for (const rec of records) {
    byCategory[rec.category] += rec.count;
    reads += rec.count;
  }
  return { reads, sites: records.length, byCategory };
}

/** Assemble the stable report envelope around a set of records. */
export function buildReport(records: SiteRecord[], version: string, command?: string[]): Report {
  const report: Report = {
    tool: "randspy",
    schema: 1,
    version,
    summary: summarize(records),
    records,
  };
  if (command !== undefined) report.command = command;
  return report;
}
