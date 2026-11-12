import { generateSimliSessionToken } from "simli-client";
import {
  DEFAULT_SIMLI_FACE_ID,
  MissingEnvError,
  UPSTREAM_TIMEOUT_MS,
  errorResponse,
  optionalEnv,
  rejectUnlessSessionsAllowed,
  requireEnv,
  withTimeout,
} from "@/lib/serverEnv";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Simli session token. The API key never leaves the server.
 */
export async function POST() {
  // TODO before deploying: replace this with your app's auth and/or rate limiting
  // (e.g. require a signed-in user, limit sessions per user / IP). Anyone who can call
  // this route can start Simli sessions billed to your account. In production the route
  // refuses (403) unless ALLOW_UNAUTHENTICATED_SESSIONS=true.
  const rejected = rejectUnlessSessionsAllowed();
  if (rejected) return rejected;

  let apiKey: string;
  try {
    ({ SIMLI_API_KEY: apiKey } = requireEnv("SIMLI_API_KEY"));
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(err.message);
      return errorResponse(500, "Server is not configured.", err.message);
    }
    throw err;
  }

  try {
    const { session_token, warnings } = await withTimeout(
      generateSimliSessionToken({
        apiKey,
        config: {
          faceId: optionalEnv("SIMLI_FACE_ID") ?? DEFAULT_SIMLI_FACE_ID,
          maxSessionLength: 600, // seconds: hard cap per session
          maxIdleTime: 180, // seconds without audio before Simli ends the session
          handleSilence: true, // ElevenLabs audio arrives in bursts (sendAudioData), so let Simli fill the gaps
          // 16:9, Trinity-2's full frame, to match the player in app/Components/VideoBox.tsx.
          // For a square layout use 768x768 and set the player to aspect-square.
          streaming_width: 1366,
          streaming_height: 768,
        },
      }),
      UPSTREAM_TIMEOUT_MS,
      "Simli token request",
    );
    if (warnings?.length) console.warn("Simli token warnings:", warnings);
    return Response.json({ session_token }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // generateSimliSessionToken throws the API's raw response body: log it, don't echo it in production.
    console.error("Simli token error:", err);
    return errorResponse(502, "Could not start the avatar session.", `Simli: ${String(err)}`);
  }
}
