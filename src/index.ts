/**
 * Public programmatic API. Everything the CLI does is reachable from
 * here: install a spy in-process (`RandSpy`, `withSpy`), aggregate raw
 * events, filter and render reports, or reuse the stack/glob helpers.
 */
export { aggregate, buildReport, compareRecords, summarize } from "./aggregate.js";
export { globToRegExp, matchGlob } from "./match.js";
export type { FailGate, FilterOptions, RenderOptions } from "./report.js";
export {
  applyFilters,
  explainTopic,
  HINTS,
  isAllowed,
  parseCategories,
  parseFailGate,
  relativize,
  renderJson,
  renderText,
  shouldFail,
} from "./report.js";
export type { StackFrame } from "./stack.js";
export { firstExternalFrame, firstUserFrame, isNodeInternal, normalizeFile, parseStack } from "./stack.js";
export { RandSpy, withSpy, withSpyAsync } from "./spy.js";
export type {
  Category,
  Report,
  ReportSummary,
  Site,
  SiteRecord,
  SpyEvent,
  SpyOptions,
} from "./types.js";
export { CATEGORIES } from "./types.js";
export { VERSION } from "./version.js";
