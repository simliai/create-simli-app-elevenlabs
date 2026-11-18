import {
  ElevenLabsError,
  forgetStarterAgent,
  getSignedUrl,
  getStarterAgentId,
} from "@/lib/elevenlabsAgent";
import {
  MissingEnvError,
  errorResponse,
  optionalEnv,
  rejectUnlessSessionsAllowed,
  requireEnv,
} from "@/lib/serverEnv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns a signed WebSocket URL for the ElevenLabs agent. The URL is short-lived (about
 * 15 minutes to start a conversation); the ElevenLabs API key never leaves the server.
 *
 * Which agent:
 * - ELEVENLABS_AGENT_ID set: that agent, as configured in your ElevenLabs dashboard.
 * - Otherwise: the starter's own agent, found (or created on first use) via the Agents API
 *   and kept in sync with app/avatar.ts. See lib/elevenlabsAgent.ts.
 *
 * Docs: https://elevenlabs.io/docs/eleven-agents/customization/authentication
 */
export async function POST() {
  // TODO before deploying: replace this with your app's auth and/or rate limiting.
  // Anyone who can call this route can start conversations billed to your ElevenLabs
  // account. In production the route refuses (403) unless ALLOW_UNAUTHENTICATED_SESSIONS=true.
  const rejected = rejectUnlessSessionsAllowed();
  if (rejected) return rejected;

  let apiKey: string;
  try {
    ({ ELEVENLABS_API_KEY: apiKey } = requireEnv("ELEVENLABS_API_KEY"));
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(err.message);
      return errorResponse(500, "Server is not configured.", err.message);
    }
    throw err;
  }
  const fixedAgentId = optionalEnv("ELEVENLABS_AGENT_ID");

  try {
    let agentId = fixedAgentId ?? (await getStarterAgentId(apiKey));
    let signed_url: string;
    try {
      signed_url = await getSignedUrl(apiKey, agentId);
    } catch (err) {
      // The cached starter agent was deleted (e.g. in the dashboard): look it up / recreate once.
      if (fixedAgentId || !(err instanceof ElevenLabsError) || err.status !== 404) throw err;
      forgetStarterAgent();
      agentId = await getStarterAgentId(apiKey);
      signed_url = await getSignedUrl(apiKey, agentId);
    }
    return Response.json({ signed_url }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      console.error(err.message);
      const status = err.status === 429 ? 429 : 502;
      return errorResponse(status, err.publicMessage, err.message);
    }
    console.error("ElevenLabs signed URL: unexpected error:", err);
    return errorResponse(502, "Could not start the voice agent.", `Unexpected error: ${String(err)}`);
  }
}
