import "server-only";
import { createHash } from "node:crypto";
import { avatar } from "@/app/avatar";
import { SESSION_MAX_SECONDS, UPSTREAM_TIMEOUT_MS } from "@/lib/serverEnv";

/**
 * Finds or creates this starter's ElevenLabs agent, keeps it in sync with app/avatar.ts,
 * and mints signed URLs for it. Only ELEVENLABS_API_KEY is needed.
 *
 * - The agent is found by the tag `simli-starter` (stable even if you rename it).
 * - A second tag, `simli-config-<hash>`, records which avatar.ts config it was last synced
 *   to. When the hash differs, the agent is PATCHed with the new config: no new agent.
 * - Results are cached per server process, and concurrent first requests share one
 *   in-flight lookup, so a process never creates two agents.
 * - Across processes (e.g. two serverless instances racing on the very first request):
 *   after creating, the server lists the tagged agents again; if an older one exists it
 *   deletes the agent it just created and uses the oldest. Every process picks the oldest,
 *   so they all converge on the same agent.
 *
 * API reference (Agents Platform):
 *   create:     POST   /v1/convai/agents/create
 *   list:       GET    /v1/convai/agents?tags=...
 *   update:     PATCH  /v1/convai/agents/{agent_id}
 *   delete:     DELETE /v1/convai/agents/{agent_id}
 *   signed URL: GET    /v1/convai/conversation/get-signed-url?agent_id=...
 *   https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create
 */

const API = "https://api.elevenlabs.io";
export const STARTER_TAG = "simli-starter";
const CONFIG_TAG_PREFIX = "simli-config-";

// ---------------------------------------------------------------------------------------
// Errors

/** An ElevenLabs request failed. `message` is for developers; `publicMessage` is safe for visitors. */
export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

const KEY_HINT = "Create a key at https://elevenlabs.io/app/settings/api-keys, put it in .env.local and restart `npm run dev`.";
const GENERIC = "Could not start the voice agent.";

/**
 * Turns an ElevenLabs error response into a readable message. ElevenLabs errors look like
 * {"detail": {"status": "invalid_api_key", "code": "...", "message": "..."}} (or a FastAPI
 * validation list for 422). Matching is on `status` / `code` first, then on the message.
 */
export function describeElevenLabsError(httpStatus: number, body: string, action: string): ElevenLabsError {
  let code = "";
  let upstream = "";
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    const d = parsed.detail;
    if (typeof d === "string") upstream = d;
    else if (Array.isArray(d)) {
      upstream = d
        .map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).join(".")}: ${e.msg ?? ""}`)
        .join("; ");
    } else if (d && typeof d === "object") {
      const o = d as { status?: string; code?: string; message?: string };
      code = `${o.status ?? ""} ${o.code ?? ""}`.toLowerCase();
      upstream = o.message ?? "";
    }
  } catch {
    upstream = body.slice(0, 200);
  }
  const text = `${code} ${upstream}`.toLowerCase();
  const err = (msg: string, pub = GENERIC) => new ElevenLabsError(httpStatus, `ElevenLabs ${action} failed (${httpStatus}): ${msg}`, pub);

  // Never echo upstream text for auth failures.
  if (code.includes("invalid_api_key") || (httpStatus === 401 && !text.includes("permission") && !text.includes("quota"))) {
    return err(`ELEVENLABS_API_KEY was rejected (invalid API key). ${KEY_HINT}`);
  }
  if (text.includes("missing_permission") || text.includes("permission")) {
    return err(
      "your ELEVENLABS_API_KEY is missing a permission. Edit the key at https://elevenlabs.io/app/settings/api-keys " +
        "and give it ElevenLabs Agents access (read and write), or create a key without restrictions.",
    );
  }
  if (text.includes("quota") || text.includes("credit") || text.includes("insufficient")) {
    return err(
      "your ElevenLabs account is out of credits or agent minutes (the free plan includes 15 call minutes a month). " +
        "Wait for the monthly reset, buy Pay As You Go credits, or upgrade at https://elevenlabs.io/app/subscription.",
      "The voice agent is out of credits for now. Please try again later.",
    );
  }
  if (text.includes("voice_not_found") || (text.includes("voice") && (text.includes("not found") || text.includes("does not exist")))) {
    return err(`the voice "${avatar.elevenlabs_voice_id}" was not found. Set elevenlabs_voice_id in app/avatar.ts to a voice from https://elevenlabs.io/app/voice-library.`);
  }
  if (text.includes("free users") || text.includes("paid_plan") || text.includes("subscription") || httpStatus === 402) {
    const voice = text.includes("voice") ? ` The voice "${avatar.elevenlabs_voice_id}" may need a paid plan: pick another in app/avatar.ts.` : "";
    return err(`your ElevenLabs plan doesn't allow this${upstream ? ` (${upstream})` : ""}.${voice}`);
  }
  if (httpStatus === 429 || text.includes("concurren") || text.includes("too_many") || text.includes("rate limit") || text.includes("system_busy")) {
    return err(
      "too many conversations at once for your ElevenLabs plan (the free plan allows 4). End other sessions and try again.",
      "The voice agent is busy. Please try again in a minute.",
    );
  }
  if (httpStatus === 404) {
    return err(`not found${upstream ? ` (${upstream})` : ""}. If ELEVENLABS_AGENT_ID is set, check it, or remove it to let the app create its own agent.`);
  }
  if (httpStatus >= 500) return err("ElevenLabs is having problems. Try again shortly.", "The voice agent is temporarily unavailable.");
  return err(upstream || "unexpected error");
}

async function el<T>(apiKey: string, method: string, path: string, action: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { "xi-api-key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ElevenLabsError(0, `Could not reach ElevenLabs (${action}): ${String(e)}`, "Could not reach the voice agent.");
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw describeElevenLabsError(res.status, text, action);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ElevenLabsError(502, `ElevenLabs ${action}: response was not JSON.`, GENERIC);
  }
}

// ---------------------------------------------------------------------------------------
// Desired agent config (from app/avatar.ts)

function desiredAgent() {
  return {
    name: `${avatar.name} (Simli starter)`,
    conversation_config: {
      agent: {
        first_message: avatar.firstMessage,
        language: avatar.language,
        prompt: { prompt: avatar.initialPrompt, llm: avatar.llm },
      },
      // Simli needs raw PCM16 at 16 kHz, both for what it plays and (here) for the mic.
      tts: { voice_id: avatar.elevenlabs_voice_id, agent_output_audio_format: "pcm_16000" },
      asr: { user_input_audio_format: "pcm_16000" },
      // Same cap as Simli's maxSessionLength, enforced by ElevenLabs even if a client
      // keeps the socket open.
      conversation: { max_duration_seconds: SESSION_MAX_SECONDS },
    },
    platform_settings: {
      // Only signed URLs (minted by this server) can start conversations.
      auth: { enable_auth: true },
      call_limits: {
        agent_concurrency_limit: avatar.limits.maxConcurrentConversations,
        daily_limit: avatar.limits.maxConversationsPerDay,
        bursting_enabled: false, // no double-rate calls above the plan's concurrency
      },
      // Client overrides (prompt, voice, first message...) stay at ElevenLabs' default: disabled.
    },
  };
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------------------
// Find or create, with per-process cache and in-flight de-duplication

interface AgentSummary {
  agent_id: string;
  name: string;
  tags?: string[];
  created_at_unix_secs?: number;
}

type State = { cache: Map<string, string>; inflight: Map<string, Promise<string>> };
// On globalThis so dev-mode hot reloads don't drop it.
const g = globalThis as typeof globalThis & { __simliElevenLabsAgent?: State };
const state: State = (g.__simliElevenLabsAgent ??= { cache: new Map(), inflight: new Map() });

async function listStarterAgents(apiKey: string): Promise<AgentSummary[]> {
  const all: AgentSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ page_size: "100", archived: "false" });
    q.append("tags", STARTER_TAG);
    if (cursor) q.set("cursor", cursor);
    const r = await el<{ agents?: AgentSummary[]; has_more?: boolean; next_cursor?: string | null }>(
      apiKey,
      "GET",
      `/v1/convai/agents?${q}`,
      "list agents",
    );
    all.push(...(r.agents ?? []));
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  // Filter again locally, then oldest first: every process picks the same one.
  return all
    .filter((a) => a.tags?.includes(STARTER_TAG))
    .sort((a, b) => (a.created_at_unix_secs ?? 0) - (b.created_at_unix_secs ?? 0) || a.agent_id.localeCompare(b.agent_id));
}

async function syncAgent(apiKey: string, agent: AgentSummary, desired: ReturnType<typeof desiredAgent>, configTag: string) {
  if (agent.tags?.includes(configTag)) return;
  const tags = [...(agent.tags ?? []).filter((t) => t !== STARTER_TAG && !t.startsWith(CONFIG_TAG_PREFIX)), STARTER_TAG, configTag];
  await el(apiKey, "PATCH", `/v1/convai/agents/${encodeURIComponent(agent.agent_id)}`, "update agent", { ...desired, tags });
  console.info(`ElevenLabs agent ${agent.agent_id} updated to match app/avatar.ts (${configTag}).`);
}

async function findOrCreate(apiKey: string, desired: ReturnType<typeof desiredAgent>, configTag: string): Promise<string> {
  const existing = await listStarterAgents(apiKey);
  if (existing.length) {
    if (existing.length > 1) {
      console.warn(`Found ${existing.length} ElevenLabs agents tagged ${STARTER_TAG}; using the oldest, ${existing[0].agent_id}.`);
    }
    await syncAgent(apiKey, existing[0], desired, configTag);
    return existing[0].agent_id;
  }

  const { agent_id } = await el<{ agent_id?: string }>(apiKey, "POST", "/v1/convai/agents/create", "create agent", {
    ...desired,
    tags: [STARTER_TAG, configTag],
  });
  if (!agent_id) throw new ElevenLabsError(502, "ElevenLabs create agent: no agent_id in response.", GENERIC);
  console.info(`Created ElevenLabs agent ${agent_id} ("${desired.name}") from app/avatar.ts.`);

  // Another process may have created one at the same moment: keep the oldest, drop ours.
  try {
    const after = await listStarterAgents(apiKey);
    const winner = after[0];
    if (winner && winner.agent_id !== agent_id && after.some((a) => a.agent_id === agent_id)) {
      console.warn(`Another ElevenLabs agent ${winner.agent_id} was created concurrently; deleting duplicate ${agent_id}.`);
      await el(apiKey, "DELETE", `/v1/convai/agents/${encodeURIComponent(agent_id)}`, "delete duplicate agent").catch((e) =>
        console.error(e),
      );
      await syncAgent(apiKey, winner, desired, configTag);
      return winner.agent_id;
    }
  } catch (e) {
    console.warn("Could not re-check for duplicate agents (using the new one):", e);
  }
  return agent_id;
}

/**
 * Returns the ID of the starter agent for this API key, creating or updating it if needed.
 * Cheap after the first call in a process: no ElevenLabs request until avatar.ts changes.
 */
export async function getStarterAgentId(apiKey: string): Promise<string> {
  const desired = desiredAgent();
  const configTag = CONFIG_TAG_PREFIX + hashOf(desired);
  const key = `${hashOf(apiKey)}:${configTag}`;

  const cached = state.cache.get(key);
  if (cached) return cached;
  let pending = state.inflight.get(key);
  if (!pending) {
    pending = findOrCreate(apiKey, desired, configTag)
      .then((id) => {
        state.cache.set(key, id);
        return id;
      })
      .finally(() => state.inflight.delete(key));
    state.inflight.set(key, pending);
  }
  return pending;
}

/** Forget the cached agent (e.g. it was deleted in the dashboard), so the next call looks it up again. */
export function forgetStarterAgent() {
  state.cache.clear();
}

export async function getSignedUrl(apiKey: string, agentId: string): Promise<string> {
  const q = new URLSearchParams({ agent_id: agentId });
  const { signed_url } = await el<{ signed_url?: string }>(
    apiKey,
    "GET",
    `/v1/convai/conversation/get-signed-url?${q}`,
    "signed URL",
  );
  if (typeof signed_url !== "string" || !signed_url.startsWith("wss://")) {
    throw new ElevenLabsError(502, "ElevenLabs returned no usable signed_url.", GENERIC);
  }
  return signed_url;
}
