/**
 * Common plumbing for the four entropy patches: the record callback type,
 * the Patch interface the spy orchestrates, and a property swapper that
 * remembers exactly how to put things back (restoring the original
 * descriptor for own properties, deleting the shadow for inherited ones).
 */
import type { Category } from "../types.js";

/** Called by a patch every time a traced API fires. */
export type RecordFn = (api: string, category: Category, sample?: unknown) => void;

/** One reversible monkey-patch over a group of related APIs. */
export interface Patch {
  readonly name: string;
  install(record: RecordFn): void;
  uninstall(): void;
}

export type Restore = () => void;

/** Run restores in reverse installation order, then clear the list. */
export function runRestores(restores: Restore[]): void {
  for (let i = restores.length - 1; i >= 0; i -= 1) {
    restores[i]!();
  }
  restores.length = 0;
}

/**
 * Replace `obj[key]` with `value`, pushing an exact undo onto `restores`.
 * For inherited methods (e.g. `performance.now` lives on the prototype)
 * the shadowing own property is deleted on restore, so the original
 * prototype method reappears untouched.
 */
export function swap(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
  restores: Restore[]
): void {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: desc ? desc.enumerable : true,
    configurable: true,
  });
  restores.push(() => {
    if (desc) {
      Object.defineProperty(obj, key, desc);
    } else {
      delete obj[key];
    }
  });
}
