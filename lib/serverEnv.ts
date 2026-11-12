import "server-only";

export const isProduction = process.env.NODE_ENV === "production";

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

// Simli's default Trinity-2 face. Override with SIMLI_FACE_ID.
export const DEFAULT_SIMLI_FACE_ID = "14c60d62-6ebf-424d-b626-1f4f91c33b04";

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

/**
 * JSON error for the browser. In development it carries the detailed message; in production
 * only the short public one (details stay in the server log), so upstream bodies, env var
 * names and config values aren't echoed to visitors.
 */
export function errorResponse(status: number, publicMessage: string, devDetail?: string) {
  const error = !isProduction && devDetail ? devDetail : publicMessage;
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Fail closed in production: the session-minting routes refuse to run without real auth.
 * Returns a 403 response to send, or null when the request may continue.
 *
 * Replace this with your own check (signed-in user, rate limit). ALLOW_UNAUTHENTICATED_SESSIONS
 * is only for demos and internal deploys.
 */
export function rejectUnlessSessionsAllowed(): Response | null {
  if (!isProduction || process.env.ALLOW_UNAUTHENTICATED_SESSIONS === "true") return null;
  return Response.json(
    {
      error:
        "Session creation is disabled in production until authentication is added. " +
        "See 'Before you deploy' in the README.",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** Rejects if `promise` doesn't settle within `ms` (for SDK calls that don't take an AbortSignal). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const UPSTREAM_TIMEOUT_MS = 10_000;
