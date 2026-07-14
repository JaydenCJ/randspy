/**
 * The spy itself: installs the four patches, receives their record
 * callbacks, resolves each read to a user-code call site and buffers
 * events until `report()` aggregates them.
 *
 * Re-entrancy is guarded (a patched API called while recording another
 * event is ignored) and the tracer's own dist files are skipped during
 * site resolution, so randspy never reports itself.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, buildReport } from "./aggregate.js";
import { envPatch } from "./patch/env.js";
import { orderPatch } from "./patch/order.js";
import { randomPatch } from "./patch/random.js";
import type { Patch } from "./patch/shared.js";
import { timePatch } from "./patch/time.js";
import { firstExternalFrame, firstUserFrame, isNodeInternal, parseStack } from "./stack.js";
import type { Category, Report, Site, SpyEvent, SpyOptions } from "./types.js";
import { VERSION } from "./version.js";

/** Directory the compiled tracer lives in; frames under it are never blamed. */
const SELF_DIR = dirname(fileURLToPath(import.meta.url));

const MAX_SAMPLE_LENGTH = 60;

function formatSample(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return text.length > MAX_SAMPLE_LENGTH ? `${text.slice(0, MAX_SAMPLE_LENGTH - 1)}…` : text;
}

interface ResolvedSite extends Site {
  internal: boolean;
}

export class RandSpy {
  private readonly events: SpyEvent[] = [];
  private readonly patches: Patch[];
  private readonly captureValues: boolean;
  private readonly includeInternals: boolean;
  private readonly maxSamples: number;
  private readonly skipFiles: string[];
  private active = false;
  private recording = false;

  constructor(options: SpyOptions = {}) {
    this.captureValues = options.captureValues ?? false;
    this.includeInternals = options.includeInternals ?? false;
    this.maxSamples = options.maxSamples ?? 3;
    this.skipFiles = options.skipFiles ?? [];
    this.patches = [timePatch(), randomPatch(), envPatch(), orderPatch()];
  }

  /** True while the patches are installed. */
  get enabled(): boolean {
    return this.active;
  }

  /** Number of buffered raw events (before aggregation). */
  get size(): number {
    return this.events.length;
  }

  /** Install all patches. Idempotent. */
  enable(): void {
    if (this.active) return;
    for (const patch of this.patches) patch.install(this.record);
    this.active = true;
  }

  /** Restore every patched API exactly. Idempotent. */
  disable(): void {
    if (!this.active) return;
    // Uninstall in reverse install order so nested swaps unwind cleanly.
    for (let i = this.patches.length - 1; i >= 0; i -= 1) {
      this.patches[i]!.uninstall();
    }
    this.active = false;
  }

  /** Drop all buffered events. */
  clear(): void {
    this.events.length = 0;
  }

  /** Aggregate buffered events into the stable report shape. */
  report(command?: string[]): Report {
    return buildReport(aggregate(this.events, this.maxSamples), VERSION, command);
  }

  private readonly record = (api: string, category: Category, sample?: unknown): void => {
    if (!this.active || this.recording) return;
    this.recording = true;
    try {
      const site = this.captureSite();
      if (site === null) return;
      const event: SpyEvent = {
        category,
        api,
        site: { file: site.file, line: site.line, column: site.column },
        internal: site.internal,
      };
      if (this.captureValues && sample !== undefined && category !== "env") {
        event.sample = formatSample(sample);
      }
      this.events.push(event);
    } finally {
      this.recording = false;
    }
  };

  private captureSite(): ResolvedSite | null {
    const savedLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 30;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = savedLimit;
    const frames = parseStack(stack);
    const skip = (file: string): boolean =>
      file.startsWith(SELF_DIR) || this.skipFiles.some((s) => file.includes(s));
    // The nearest real frame decides the event's nature. If it is user
    // code (including node_modules), the user wrote this read: blame it.
    // If it is a `node:` internal, the runtime read the source on the
    // user's behalf (e.g. console.log probing process.env.FORCE_COLOR) —
    // that is not the user's entropy, so it is dropped unless
    // `includeInternals` asks for it, in which case the nearest user
    // frame (if any) is shown with an "internal" marker.
    const external = firstExternalFrame(frames, skip);
    if (!external) return null;
    if (!isNodeInternal(external.file)) {
      return { file: external.file, line: external.line, column: external.column, internal: false };
    }
    if (!this.includeInternals) return null;
    const user = firstUserFrame(frames, skip) ?? external;
    return { file: user.file, line: user.line, column: user.column, internal: true };
  }
}

/**
 * Run a synchronous function under a fresh spy and return its result plus
 * the report. The spy is always disabled afterwards, even on throw.
 */
export function withSpy<T>(
  fn: (spy: RandSpy) => T,
  options: SpyOptions = {}
): { result: T; report: Report } {
  const spy = new RandSpy(options);
  spy.enable();
  try {
    const result = fn(spy);
    return { result, report: spy.report() };
  } finally {
    spy.disable();
  }
}

/**
 * Async variant of {@link withSpy}. Note that anything else scheduled on
 * the event loop while `fn` is awaited is traced too — that is usually
 * what you want in a test, but it widens the net.
 */
export async function withSpyAsync<T>(
  fn: (spy: RandSpy) => Promise<T>,
  options: SpyOptions = {}
): Promise<{ result: T; report: Report }> {
  const spy = new RandSpy(options);
  spy.enable();
  try {
    const result = await fn(spy);
    return { result, report: spy.report() };
  } finally {
    spy.disable();
  }
}
