/**
 * Minimal glob matcher for `--allow` patterns. Supports `*` (any run of
 * characters except `/`), `?` (one character except `/`) and `**` (any run
 * including `/`, so `src/**` spans directories and a leading `**` slash
 * prefix matches at any depth). Full-string anchored, case-sensitive —
 * exactly enough surface for suppressing known-good entropy sites.
 */

const REGEX_SPECIALS = new Set(["\\", "^", "$", ".", "|", "+", "(", ")", "[", "]", "{", "}"]);

/** Compile a glob into an anchored RegExp. Deterministic, no caching state. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // `**/` also matches "nothing": `**/x.js` must match a root-level `x.js`.
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += REGEX_SPECIALS.has(c) ? `\\${c}` : c;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when `text` matches `pattern` in full. */
export function matchGlob(pattern: string, text: string): boolean {
  return globToRegExp(pattern).test(text);
}
