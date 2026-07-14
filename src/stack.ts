/**
 * V8 stack-trace parsing and call-site selection.
 *
 * Pure string functions: the spy captures `new Error().stack` at the moment
 * a patched API is called and this module turns it into frames, then picks
 * the first frame that belongs to *user* code — skipping the tracer's own
 * files and `node:` internals. That frame is the file:line:column randspy
 * reports, so precision here is what makes the tool useful.
 */
import type { Site } from "./types.js";

/** A parsed stack frame; `fn` is null for anonymous top-level frames. */
export interface StackFrame extends Site {
  fn: string | null;
}

// `    at async funcName (file:line:col)` — fn part is non-greedy so the
// location keeps any parenthesized eval origin intact.
const FRAME_WITH_FN = /^\s*at\s+(?:async\s+)?(?:new\s+)?(.+?)\s+\((.+)\)$/;
const FRAME_BARE = /^\s*at\s+(?:async\s+)?(.+)$/;
const LOCATION = /^(.*):(\d+):(\d+)$/;
// Inside `eval at outer (/app/x.js:3:5), <anonymous>:1:1` the only useful
// position is the script that *called* eval — the first parenthesized one.
const EVAL_ORIGIN = /\(([^()]+:\d+:\d+)\)/;

/** Convert `file:///...` URLs (ESM frames) to plain paths; leave others. */
export function normalizeFile(file: string): string {
  if (!file.startsWith("file://")) return file;
  const rest = file.slice("file://".length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

function parseLocation(loc: string): Site | null {
  if (loc.startsWith("eval at ")) {
    const origin = EVAL_ORIGIN.exec(loc);
    return origin ? parseLocation(origin[1]!) : null;
  }
  const m = LOCATION.exec(loc);
  if (!m) return null;
  return { file: normalizeFile(m[1]!), line: Number(m[2]!), column: Number(m[3]!) };
}

/**
 * Parse a raw V8 `error.stack` string into positioned frames. Frames with
 * no source position (`at foo (native)`, bare `<anonymous>`) are dropped —
 * they can never be a reportable site.
 */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trimEnd();
    let fn: string | null = null;
    let loc: string | null = null;
    const withFn = FRAME_WITH_FN.exec(line);
    if (withFn) {
      fn = withFn[1]!;
      loc = withFn[2]!;
    } else {
      const bare = FRAME_BARE.exec(line);
      if (bare) loc = bare[1]!;
    }
    if (loc === null) continue;
    const site = parseLocation(loc);
    if (site) frames.push({ fn, ...site });
  }
  return frames;
}

/** True for frames inside Node itself — never a useful blame target. */
export function isNodeInternal(file: string): boolean {
  return (
    file.startsWith("node:") ||
    file.startsWith("internal/") ||
    file === "<anonymous>" ||
    file === "native"
  );
}

/**
 * First frame that is neither a Node internal nor matched by `skip`
 * (the tracer's own dist files). Null means the read never reached
 * user code — e.g. Node core enumerating `process.env` during `spawn`.
 */
export function firstUserFrame(
  frames: readonly StackFrame[],
  skip: (file: string) => boolean
): StackFrame | null {
  for (const frame of frames) {
    if (isNodeInternal(frame.file)) continue;
    if (skip(frame.file)) continue;
    return frame;
  }
  return null;
}

/** First non-tracer frame, internals allowed — used by `includeInternals`. */
export function firstExternalFrame(
  frames: readonly StackFrame[],
  skip: (file: string) => boolean
): StackFrame | null {
  for (const frame of frames) {
    if (skip(frame.file)) continue;
    return frame;
  }
  return null;
}
