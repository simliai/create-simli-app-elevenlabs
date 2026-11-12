import "server-only";

/** Thrown when a required server-side environment variable is missing. */
export class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(
      `Missing server environment variable${names.length > 1 ? "s" : ""}: ${names.join(", ")}. ` +
        "Copy .env.example to .env.local, fill it in, and restart `npm run dev`.",
    );
    this.name = "MissingEnvError";
  }
}

// Trinity-2 preset "Anna". Override with SIMLI_FACE_ID.
export const DEFAULT_SIMLI_FACE_ID = "bf13113a-355a-4d97-8b90-4edccd1da7b2";

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Reads the named variables, or throws a MissingEnvError listing every one that is unset. */
export function requireEnv<const K extends string>(...names: K[]): Record<K, string> {
  const missing = names.filter((n) => !read(n));
  if (missing.length) throw new MissingEnvError(missing);
  return Object.fromEntries(names.map((n) => [n, read(n)!])) as Record<K, string>;
}

export function optionalEnv(name: string): string | undefined {
  return read(name);
}
