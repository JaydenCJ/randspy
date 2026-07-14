/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 *
 * The `node:fs` and `node:crypto` shapes are deliberately loose function
 * properties: the tracer monkey-patches them at runtime, so they must be
 * assignable, and their real overload sets are irrelevant here.
 */

declare module "node:fs" {
  export interface FsLike {
    readdirSync: (...args: unknown[]) => unknown;
    readdir: (...args: unknown[]) => unknown;
    promises: { readdir: (...args: unknown[]) => unknown };
    readFileSync(path: string, encoding: "utf8"): string;
    writeFileSync(path: string, data: string): void;
    writeSync(fd: number, data: string): number;
    mkdtempSync(prefix: string): string;
    rmSync(path: string, opts: { recursive: boolean; force: boolean }): void;
    existsSync(path: string): boolean;
  }
  const fs: FsLike;
  export default fs;
}

declare module "node:crypto" {
  export interface WebCryptoLike {
    getRandomValues?: (...args: unknown[]) => unknown;
    randomUUID?: (...args: unknown[]) => unknown;
  }
  export interface CryptoLike {
    randomBytes: (...args: unknown[]) => unknown;
    randomInt: (...args: unknown[]) => unknown;
    randomUUID: (...args: unknown[]) => unknown;
    randomFillSync: (...args: unknown[]) => unknown;
    webcrypto: WebCryptoLike;
  }
  const crypto: CryptoLike;
  export default crypto;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function basename(p: string, ext?: string): string;
  export function dirname(p: string): string;
  export function isAbsolute(p: string): boolean;
  export const sep: string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
  export function pathToFileURL(path: string): { href: string };
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:child_process" {
  export interface SpawnSyncResult {
    status: number | null;
    signal: string | null;
    error?: Error;
  }
  export function spawnSync(
    cmd: string,
    args: string[],
    opts: { stdio: "inherit"; env: Record<string, string | undefined> }
  ): SpawnSyncResult;
}

declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  pid: number;
  cwd(): string;
  exitCode: number | undefined;
  exit(code?: number): never;
  hrtime: ((time?: [number, number]) => [number, number]) & { bigint(): bigint };
  on(event: string, listener: (...args: unknown[]) => void): void;
  stdout: {
    write(chunk: string): boolean;
    on(event: "error", listener: (err: Error & { code?: string }) => void): void;
  };
  stderr: {
    write(chunk: string): boolean;
    on(event: "error", listener: (err: Error & { code?: string }) => void): void;
  };
};

declare var performance: { now(): number };

interface ErrorConstructor {
  stackTraceLimit: number;
}

interface ImportMeta {
  url: string;
}
