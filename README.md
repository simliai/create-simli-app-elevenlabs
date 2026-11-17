# Create Simli App (ElevenLabs)

A Next.js starter where an [ElevenLabs Agents](https://elevenlabs.io/docs/eleven-agents) conversational agent talks through a real-time [Simli](https://simli.com) avatar. Click **Test Interaction**, speak, and the agent answers with a lip-synced face.

You need two API keys (Simli and ElevenLabs) and nothing else: the app creates and configures its ElevenLabs agent for you through the Agents API. No ElevenLabs dashboard steps.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, `simli-client` 3.x.

## How it works

```
Browser                                   Your Next.js server              Third parties
───────                                   ───────────────────              ─────────────
1. POST /api/simli-token  ─────────────▶  SIMLI_API_KEY ─────────────────▶ Simli: session token
   new SimliClient(token).start()  ◀───── session_token
   (avatar on screen)
2. POST /api/elevenlabs-signed-url ────▶  ELEVENLABS_API_KEY ────────────▶ ElevenLabs: find/create agent
                                          (first request, or after          (from app/avatar.ts)
                                           app/avatar.ts changed)
                                                                    ────────▶ ElevenLabs: signed URL
   WebSocket(signed_url)  ◀────────────── signed_url
3. mic ─ PCM16 ─▶ ElevenLabs agent ─ PCM16 16 kHz audio ─▶ simliClient.sendAudioData()
                                                          ─▶ Simli video + in-sync voice
```

- **The agent is managed for you.** Unless you set `ELEVENLABS_AGENT_ID`, the server finds this starter's agent (by its `simli-starter` tag) or creates it on the first request, configured from `app/avatar.ts`. See [The managed agent](#the-managed-agent).
- **No API keys in the browser.** Both keys live in server-only environment variables. The browser only receives a short-lived Simli session token and a short-lived (about 15 minutes) ElevenLabs signed URL.
- **Simli starts first.** The ElevenLabs conversation opens only after the avatar is on screen, so the agent's greeting isn't lost.
- **Only Simli's audio is played.** The agent's audio is forwarded to Simli and never played directly, so you hear one voice, in sync with the lips.
- **Interruptions** (`interruption` events) clear the avatar's audio buffer, so it stops talking when you barge in.
- **Linked lifecycle.** Ending either side ends both: the Stop button, the agent ending the call, Simli's `maxSessionLength` (600 s) or `maxIdleTime` (180 s), errors, leaving the page.

## Setup

Requires Node.js 20.9 or newer.

### 1. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Where to get it |
|---|---|---|
| `SIMLI_API_KEY` | yes | [app.simli.com](https://app.simli.com), API key section |
| `ELEVENLABS_API_KEY` | yes | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys). If you restrict the key, give it **ElevenLabs Agents** read and write access (it creates and updates the agent) |
| `SIMLI_FACE_ID` | no | Defaults to Simli's default Trinity-2 face (`14c60d62-6ebf-424d-b626-1f4f91c33b04`). Other [presets](https://docs.simli.com/api-reference/preset-faces), or your own avatars in the Simli dashboard |
| `ELEVENLABS_AGENT_ID` | no | Only to use an agent you configured yourself (`agent_...`) instead of the managed one. See [Bring your own agent](#bring-your-own-agent) |
| `ALLOW_UNAUTHENTICATED_SESSIONS` | no | Production only. Leave unset/`false`: in production both session routes return 403 until you add your own auth. `true` is only for demos and internal deploys. Ignored by `npm run dev` |

All of them are read on the server only. Don't rename them to `NEXT_PUBLIC_*`: that would ship them to every visitor's browser. If a variable is missing, the dev server tells you which one when you click **Test Interaction** (production builds only return a generic message and log the detail on the server).

### 2. (Optional) Customize the agent

Edit `app/avatar.ts`: name, system prompt, first message, voice, language, LLM and call limits. The default voice is female, to match the default face. The next request after you save syncs the agent.

### 3. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000 (the dev server listens on 127.0.0.1 only), click **Test Interaction** and allow microphone access. Use headphones if the agent keeps interrupting itself (echo cancellation is on, but speakers can still leak into the mic).

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`.

To reach the dev server from another device on purpose (for example a phone on your LAN), run `npx next dev -H 0.0.0.0`. Anyone on that network can then start sessions on your keys, and browsers only allow the microphone on `localhost` or HTTPS, so use an HTTPS tunnel for real testing.

## Customizing

- **Avatar:** set `SIMLI_FACE_ID`. Create your own avatar from a photo at [app.simli.com](https://app.simli.com).
- **Session limits and framing:** `app/api/simli-token/route.ts` (`maxSessionLength`, `maxIdleTime`, `streaming_width` / `streaming_height`). The stream is 16:9 (1366x768, Trinity-2's full frame) to match the player in `app/Components/VideoBox.tsx`. For a square layout use `768x768` and change the player to `aspect-square`. See [Trinity-2 framing](https://docs.simli.com/api-reference/trinity-2).
- **Agent behaviour** (prompt, first message, voice, language, LLM, limits): `app/avatar.ts`. For tools or a knowledge base, edit the agent in the ElevenLabs dashboard (those fields aren't touched by the sync), or use your own agent with `ELEVENLABS_AGENT_ID`.

## The managed agent

Without `ELEVENLABS_AGENT_ID`, `POST /api/elevenlabs-signed-url` does this (`lib/elevenlabsAgent.ts`):

1. **Find:** [list agents](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/list) with the tag `simli-starter` (`GET /v1/convai/agents?tags=simli-starter`). If there are several, it uses the oldest.
2. **Create** if none: [`POST /v1/convai/agents/create`](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create), named `<name> (Simli starter)`, tagged `simli-starter` and `simli-config-<hash>`.
3. **Sync:** the `simli-config-<hash>` tag is a hash of the config built from `app/avatar.ts`. If the agent's tag doesn't match (you edited `avatar.ts`), the agent is [updated](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/update) (`PATCH /v1/convai/agents/{id}`) in place. Other tags you add are kept.
4. **Signed URL:** [`GET /v1/convai/conversation/get-signed-url?agent_id=...`](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url).

The result is cached in the server process, so later requests only fetch a signed URL. Concurrent first requests share one lookup, so one process never creates two agents. If two server instances race on the very first request, each re-lists after creating, keeps the oldest agent and deletes the duplicate it created itself. If you delete the agent in the dashboard, the next request creates a new one.

What the app sets on the agent:

| Setting | Value | Why |
|---|---|---|
| `conversation_config.tts.agent_output_audio_format` | `pcm_16000` | Simli needs raw PCM16 at 16 kHz |
| `conversation_config.asr.user_input_audio_format` | `pcm_16000` | The page sends 16 kHz PCM16 from the mic |
| `conversation_config.tts.voice_id` | `avatar.elevenlabs_voice_id` | Female voice for the default face |
| `conversation_config.agent.first_message`, `.language`, `.prompt.prompt`, `.prompt.llm` | from `avatar.ts` | |
| `conversation_config.conversation.max_duration_seconds` | `600` | Same cap as Simli's `maxSessionLength`, enforced by ElevenLabs |
| `platform_settings.auth.enable_auth` | `true` | Only signed URLs from your server can start conversations ([docs](https://elevenlabs.io/docs/eleven-agents/customization/authentication)) |
| `platform_settings.call_limits` | 4 concurrent, 100 per day, no burst | Provider-side spend cap (`avatar.limits`) |

Client overrides (prompt, voice, first message from the browser) stay disabled, ElevenLabs' default. Edits you make to these fields in the dashboard last until you next change `avatar.ts`; the sync then overwrites them. Other settings (tools, knowledge base, evaluation...) are never touched.

### Bring your own agent

Set `ELEVENLABS_AGENT_ID` to use an agent you manage in the dashboard. The app then never creates or changes agents; it only requests signed URLs. Configure that agent yourself: TTS output format **PCM 16000 Hz** (the app stops with a message otherwise), PCM user input, a first message, a voice that matches the face, **authentication enabled**, call limits and a maximum conversation duration. Keep client overrides disabled.

## ElevenLabs free plan

As of November 2026, for ElevenAgents ([pricing](https://elevenlabs.io/pricing/agents)):

- **15 call minutes a month and 4 concurrent calls** on the Free plan. Extra minutes cost $0.08/min on every plan, but you can only go past your quota after buying [Pay As You Go](https://elevenlabs.io/docs/overview/administration/pay-as-you-go) credits ([help center](https://elevenlabs.io/docs/help-center/product/eleven-agents/how-much-does-eleven-agents-cost)). Silence over 10 s is billed at a 95% discount. A 10-minute session uses most of the free month, so keep test calls short.
- **LLM costs are extra on every plan**, including Free: passed through at the provider's rate and deducted from your credits ([pricing FAQ](https://elevenlabs.io/pricing/agents), [LLM docs](https://elevenlabs.io/docs/eleven-agents/customization/llm)). That's why `avatar.ts` defaults to `gemini-3.5-flash-lite`, Google's low-cost tier. Compare exact per-minute LLM costs in the dashboard (agent → Primary LLM → *Detailed costs*).
- **No commercial use.** The Free plan has no commercial license; content you publish needs attribution to ElevenLabs ([help center](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform)). Starter and up include a commercial license.
- **Voices:** some Voice Library voices are paid-only ("This voice is not available for free users", [help center](https://elevenlabs.io/docs/help-center/product/voices/voice-library/why-cant-i-use-some-voices-from-the-voice-library)). The old Default voices (Sarah, Eric, ...) only exist on accounts created before March 2026 and expire on 31 Dec 2026 ([help center](https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices)); `avatar.ts` uses their official replacements. If ElevenLabs refuses the voice on your plan, the app says so: pick another voice in `avatar.ts`.
- Creating agents via the API and signed URLs are not listed as paid features; agent creation itself is free. *Not yet tested end-to-end on a Free account with this app.*

Limits and prices change: check the pricing page before relying on them.

## Before you deploy

Both API routes spend money (Simli minutes, ElevenLabs credits).

**What the server enforces as shipped**
- In production (`NODE_ENV=production`, i.e. `next start` or Vercel) `POST /api/simli-token` and `POST /api/elevenlabs-signed-url` return **403** unless `ALLOW_UNAUTHENTICATED_SESSIONS=true`. That flag turns them into open endpoints: only use it for demos or internal deploys.
- Each Simli session is capped by Simli itself: `maxSessionLength` 600 s and `maxIdleTime` 180 s, set in the token.
- Production error responses are generic; details are only in the server log.
- Upstream calls time out after 10 s. Security headers (`frame-ancestors 'self'`, microphone limited to this origin, `nosniff`, `strict-origin-when-cross-origin`) are set in `next.config.ts`.

**What is not capped**
- There is **no auth and no rate limiting**: the number of sessions per user, per IP or per day is unlimited. Replace the `ALLOW_UNAUTHENTICATED_SESSIONS` check with your own (the `TODO` in each route): require a signed-in user and limit sessions per user / IP.
- The managed agent's conversation length (600 s), concurrency (4) and daily calls (100) are enforced by ElevenLabs. With your own `ELEVENLABS_AGENT_ID`, only what you set on that agent applies: a client that keeps the signed URL can talk for as long as the agent allows.

**Set provider-side limits**
- ElevenLabs: the managed agent gets call limits from `avatar.limits` (lower them for production). For your own agent, set concurrent-call and daily-call limits and a maximum conversation duration in its Security settings, and keep client overrides disabled.
- Simli: check your plan's concurrency and minutes at [app.simli.com](https://app.simli.com) and watch usage.
- Use spending alerts / usage limits on both accounts where available.

**Keys**
- Set the environment variables in your host's settings (for example Vercel → Project → Environment Variables), never in the code or as `NEXT_PUBLIC_*`.
- **Rotate any key that was ever in a `NEXT_PUBLIC_*` variable.** Older releases of this repo used `NEXT_PUBLIC_SIMLI_API_KEY` (and some had `NEXT_PUBLIC_ELEVENLABS_API_KEY`): those keys were readable by every visitor. Rotate the Simli key, and the ElevenLabs key too if it was ever public.

## Using a coding agent?

The [Simli agent skill](.agents/skills/simli) is included in this repo (`.agents/skills/simli`, linked at `.claude/skills/simli`), so coding agents such as Claude Code pick up how to use Simli correctly. To install it in another project: `npx skills add simliai/skills`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing server environment variable...` | Fill in `.env.local` and restart `npm run dev` |
| `403` "Session creation is disabled in production..." | Add auth to the routes, or set `ALLOW_UNAUTHENTICATED_SESSIONS=true` for a demo |
| Generic "Could not start..." in production | See the server log for the upstream detail |
| `401` / unauthorized from Simli | Check `SIMLI_API_KEY` |
| `INVALID_FACE_ID` / `FACE_NOT_ALLOWED` | Use a preset face ID or one from your own account |
| "ELEVENLABS_API_KEY was rejected (invalid API key)" | Copy a fresh key from [API keys](https://elevenlabs.io/app/settings/api-keys) into `.env.local`, restart `npm run dev` |
| "...missing a permission" | The key is restricted: give it ElevenLabs Agents read and write access, or create an unrestricted key |
| "...out of credits or agent minutes" | Free plan: 15 min/month plus LLM credits. Wait for the reset, buy Pay As You Go credits or upgrade |
| "...too many conversations at once" | Plan concurrency (Free: 4) or `avatar.limits` reached: end other sessions |
| "...voice ... not found" / "not available for free users" | Change `elevenlabs_voice_id` in `app/avatar.ts` |
| Agent changes in the dashboard got reverted | You changed `app/avatar.ts`, which re-syncs the fields it sets. Put those changes in `avatar.ts` instead |
| "output audio format is ..." | Only with your own `ELEVENLABS_AGENT_ID`: set its TTS output format to PCM 16000 Hz, or remove the variable |
| ElevenLabs `404` with `ELEVENLABS_AGENT_ID` set | Check the agent ID, or remove it to use the managed agent |
| Avatar talks over you | Use headphones |
| `Too Many Retry Attempts` | Your network blocks Simli's media servers (VPN / firewall) |

More: [Simli docs](https://docs.simli.com) · [Discord](https://discord.gg/yQx49zNF4d)

## Upgrading from the previous version

The environment variables changed, and the keys moved to the server:

| Before | Now |
|---|---|
| `NEXT_PUBLIC_SIMLI_API_KEY` | `SIMLI_API_KEY` |
| `NEXT_PUBLIC_SIMLI_FACE_ID` | `SIMLI_FACE_ID` |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | `ELEVENLABS_AGENT_ID` (now optional) |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` (unchanged) |

`ELEVENLABS_AGENT_ID` is now optional: without it the app manages its own agent from `app/avatar.ts`. Keep it set to keep using your existing agent unchanged. `.env_sample` is now `.env.example`, and `.env.local` is the recommended file. In production the session routes return 403 until you add auth (or set `ALLOW_UNAUTHENTICATED_SESSIONS=true` for a demo). If you deployed the old version, rotate your Simli API key (and your ElevenLabs key if `NEXT_PUBLIC_ELEVENLABS_API_KEY` was ever set): they were readable by anyone who loaded the page.
