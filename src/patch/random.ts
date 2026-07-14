/**
 * The `random` patch: pseudo-random and cryptographic randomness.
 *
 * Covers `Math.random`, the node:crypto module functions (`randomBytes`,
 * `randomInt`, `randomUUID`, `randomFillSync`) and Web Crypto
 * (`getRandomValues` / `randomUUID` on `crypto.webcrypto`, which is the
 * same object as `globalThis.crypto`, so one patch covers both spellings).
 *
 * Wrappers are pass-through for every overload — callback forms included —
 * and record a sample only when the return value is a primitive, so raw
 * key material never lands in a report.
 */
import nodeCrypto from "node:crypto";
import type { Patch, RecordFn, Restore } from "./shared.js";
import { runRestores, swap } from "./shared.js";

type AnyFn = (...args: unknown[]) => unknown;

function wrapFn(original: AnyFn, api: string, record: RecordFn): AnyFn {
  return function wrapped(this: unknown, ...args: unknown[]): unknown {
    const value = original.apply(this, args);
    const sample = typeof value === "number" || typeof value === "string" ? value : undefined;
    record(api, "random", sample);
    return value;
  };
}

export function randomPatch(): Patch {
  const restores: Restore[] = [];
  return {
    name: "random",
    install(record: RecordFn): void {
      const math = Math as unknown as Record<string, unknown>;
      swap(math, "random", wrapFn(math["random"] as AnyFn, "Math.random()", record), restores);

      const cryptoObj = nodeCrypto as unknown as Record<string, unknown>;
      for (const name of ["randomBytes", "randomInt", "randomUUID", "randomFillSync"]) {
        const original = cryptoObj[name];
        if (typeof original !== "function") continue;
        swap(cryptoObj, name, wrapFn(original as AnyFn, `crypto.${name}()`, record), restores);
      }

      // globalThis.crypto === crypto.webcrypto in Node, so patching the
      // instance's methods traces both access paths at once.
      const webcrypto = nodeCrypto.webcrypto as unknown as Record<string, unknown> | undefined;
      if (webcrypto) {
        for (const name of ["getRandomValues", "randomUUID"]) {
          const original = webcrypto[name];
          if (typeof original !== "function") continue;
          const bound = (original as AnyFn).bind(webcrypto) as AnyFn;
          swap(webcrypto, name, wrapFn(bound, `crypto.${name}()`, record), restores);
        }
      }
    },
    uninstall(): void {
      runRestores(restores);
    },
  };
}
