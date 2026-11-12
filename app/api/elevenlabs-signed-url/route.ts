import { MissingEnvError, requireEnv } from "@/lib/serverEnv";

export const dynamic = "force-dynamic";

/**
 * Returns a signed WebSocket URL for the ElevenLabs agent. The URL is single-session and
 * must be used within 15 minutes; the ElevenLabs API key never leaves the server.
 * Docs: https://elevenlabs.io/docs/eleven-agents/customization/authentication
 *
 * TODO before deploying: protect this route with your app's auth and/or rate limiting.
 * Anyone who can call it can start conversations billed to your ElevenLabs account.
 */
export async function POST() {
  let env: { ELEVENLABS_API_KEY: string; ELEVENLABS_AGENT_ID: string };
  try {
    env = requireEnv("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID");
  } catch (err) {
    if (err instanceof MissingEnvError) return Response.json({ error: err.message }, { status: 500 });
    throw err;
  }

  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  url.searchParams.set("agent_id", env.ELEVENLABS_AGENT_ID);

  let res: Response;
  try {
    res = await fetch(url, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, cache: "no-store" });
  } catch (err) {
    console.error("ElevenLabs signed URL request failed:", err);
    return Response.json({ error: "Could not reach ElevenLabs." }, { status: 502 });
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    console.error("ElevenLabs signed URL error:", res.status, body);
    const hint =
      res.status === 401
        ? " Check ELEVENLABS_API_KEY (it needs Agents Platform / ElevenAgents access)."
        : res.status === 404 || res.status === 422
          ? " Check ELEVENLABS_AGENT_ID."
          : "";
    return Response.json({ error: `ElevenLabs returned ${res.status}.${hint}` }, { status: 502 });
  }

  const { signed_url } = (await res.json()) as { signed_url?: string };
  if (!signed_url) return Response.json({ error: "ElevenLabs returned no signed_url." }, { status: 502 });
  return Response.json({ signed_url }, { headers: { "Cache-Control": "no-store" } });
}
