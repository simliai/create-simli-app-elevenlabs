import { generateSimliSessionToken } from "simli-client";
import { DEFAULT_SIMLI_FACE_ID, MissingEnvError, optionalEnv, requireEnv } from "@/lib/serverEnv";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Simli session token. The API key never leaves the server.
 *
 * TODO before deploying: protect this route with your app's auth and/or rate limiting.
 * Anyone who can call it can start Simli sessions billed to your account.
 */
export async function POST() {
  let apiKey: string;
  try {
    ({ SIMLI_API_KEY: apiKey } = requireEnv("SIMLI_API_KEY"));
  } catch (err) {
    if (err instanceof MissingEnvError) return Response.json({ error: err.message }, { status: 500 });
    throw err;
  }

  try {
    const { session_token, warnings } = await generateSimliSessionToken({
      apiKey,
      config: {
        faceId: optionalEnv("SIMLI_FACE_ID") ?? DEFAULT_SIMLI_FACE_ID,
        maxSessionLength: 600, // seconds: hard cap per session
        maxIdleTime: 180, // seconds without audio before Simli ends the session
        handleSilence: true, // ElevenLabs audio arrives in bursts (sendAudioData), so let Simli fill the gaps
        // Square, to match the 350x350 player in app/Components/VideoBox.tsx.
        // For a 16:9 layout use 1366x768 and set the player's aspect-ratio to 16 / 9.
        streaming_width: 768,
        streaming_height: 768,
      },
    });
    if (warnings?.length) console.warn("Simli token warnings:", warnings);
    return Response.json({ session_token }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // generateSimliSessionToken throws the API's response body (never contains the key).
    console.error("Simli token error:", err);
    return Response.json({ error: `Simli: ${String(err)}` }, { status: 502 });
  }
}
