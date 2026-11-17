/**
 * Adds an actionable hint to ElevenLabs failures that reach the browser: WebSocket close
 * reasons and `client_error` events. (Errors from the signed-URL route are already
 * readable: the server maps ElevenLabs' status codes in lib/elevenlabsAgent.ts.)
 */
export function explainElevenLabsError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("quota") || m.includes("credit") || m.includes("insufficient"))
    return `${raw}: your ElevenLabs account is out of credits or agent minutes (the free plan includes 15 a month). Wait for the monthly reset or upgrade.`;
  if (m.includes("concurren") || m.includes("too many") || m.includes("busy"))
    return `${raw}: too many conversations at once for your ElevenLabs plan. End other sessions and try again.`;
  if (m.includes("daily") || m.includes("limit"))
    return `${raw}: an ElevenLabs limit was reached (the agent's daily-call limit is set in app/avatar.ts).`;
  if (m.includes("free users") || m.includes("subscription") || m.includes("plan"))
    return `${raw}: your ElevenLabs plan doesn't allow this (for a voice, pick another in app/avatar.ts).`;
  if (m.includes("auth") || m.includes("signature") || m.includes("expired"))
    return `${raw}: the signed URL was rejected. Click Test Interaction again to get a fresh one.`;
  if (m.includes("duration")) return `${raw}: the conversation reached its maximum length.`;
  return raw;
}
