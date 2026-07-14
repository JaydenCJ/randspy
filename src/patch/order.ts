/**
 * The `order` patch: filesystem iteration order.
 *
 * `readdir` order is not guaranteed by POSIX or by Node — it reflects
 * on-disk layout and differs across filesystems, so any code that treats
 * a directory listing as ordered is machine-dependent. This patch wraps
 * `fs.readdirSync`, callback `fs.readdir` and `fs.promises.readdir`
 * (the same object `node:fs/promises` resolves to) as pure pass-throughs.
 *
 * Known limitation (documented in the README): named ESM imports such as
 * `import { readdirSync } from "node:fs"` bind before any monkey-patch
 * can land and are not traced; `require()` and default-object imports are.
 */
import fs from "node:fs";
import type { Patch, RecordFn, Restore } from "./shared.js";
import { runRestores, swap } from "./shared.js";

type AnyFn = (...args: unknown[]) => unknown;

function wrapFn(original: AnyFn, api: string, record: RecordFn): AnyFn {
  return function wrapped(this: unknown, ...args: unknown[]): unknown {
    record(api, "order");
    return original.apply(this, args);
  };
}

export function orderPatch(): Patch {
  const restores: Restore[] = [];
  return {
    name: "order",
    install(record: RecordFn): void {
      const fsObj = fs as unknown as Record<string, unknown>;
      swap(fsObj, "readdirSync", wrapFn(fsObj["readdirSync"] as AnyFn, "fs.readdirSync()", record), restores);
      swap(fsObj, "readdir", wrapFn(fsObj["readdir"] as AnyFn, "fs.readdir()", record), restores);

      const promisesObj = fs.promises as unknown as Record<string, unknown>;
      swap(
        promisesObj,
        "readdir",
        wrapFn(promisesObj["readdir"] as AnyFn, "fs.promises.readdir()", record),
        restores
      );
    },
    uninstall(): void {
      runRestores(restores);
    },
  };
}
