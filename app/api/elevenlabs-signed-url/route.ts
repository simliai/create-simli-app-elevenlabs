import {
  MissingEnvError,
  UPSTREAM_TIMEOUT_MS,
  errorResponse,
  rejectUnlessSessionsAllowed,
  requireEnv,
} from "@/lib/serverEnv";

export const dynamic = "force-dynamic";

/**
 * Returns a signed WebSocket URL for the ElevenLabs agent. The URL is short-lived (about
 * 15 minutes to start a conversation); the ElevenLabs API key never leaves the server.
 * Docs: https://elevenlabs.io/docs/eleven-agents/customization/authentication
 */
export async function POST() {
  // TODO before deploying: replace this with your app's auth and/or rate limiting.
  // Anyone who can call this route can start conversations billed to your ElevenLabs
  // account. In production the route refuses (403) unless ALLOW_UNAUTHENTICATED_SESSIONS=true.
  const rejected = rejectUnlessSessionsAllowed();
  if (rejected) return rejected;

  let env: { ELEVENLABS_API_KEY: string; ELEVENLABS_AGENT_ID: string };
  try {
    env = requireEnv("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID");
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(err.message);
      return errorResponse(500, "Server is not configured.", err.message);
    }
    throw err;
  }

  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  url.searchParams.set("agent_id", env.ELEVENLABS_AGENT_ID);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("ElevenLabs signed URL request failed:", err);
    return errorResponse(502, "Could not reach the voice agent.", `Could not reach ElevenLabs: ${String(err)}`);
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 500);
    console.error("ElevenLabs signed URL error:", res.status, body);
    const hint =
      res.status === 401
        ? " Check ELEVENLABS_API_KEY (it needs ElevenAgents / Agents Platform access)."
        : res.status === 404 || res.status === 422
          ? " Check ELEVENLABS_AGENT_ID."
          : "";
    return errorResponse(502, "Could not start the voice agent.", `ElevenLabs returned ${res.status}.${hint}`);
  }

  let signed_url: string | undefined;
  try {
    ({ signed_url } = (await res.json()) as { signed_url?: string });
  } catch (err) {
    console.error("ElevenLabs signed URL: invalid JSON:", err);
  }
  if (typeof signed_url !== "string" || !signed_url.startsWith("wss://")) {
    console.error("ElevenLabs signed URL: response had no usable signed_url");
    return errorResponse(502, "Could not start the voice agent.", "ElevenLabs returned no signed_url.");
  }
  return Response.json({ signed_url }, { headers: { "Cache-Control": "no-store" } });
}
