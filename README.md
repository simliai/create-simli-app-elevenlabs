# Create Simli App (ElevenLabs)

A Next.js starter where an [ElevenLabs Agents](https://elevenlabs.io/docs/eleven-agents) conversational agent talks through a real-time [Simli](https://simli.com) avatar. Click **Test Interaction**, speak, and the agent answers with a lip-synced face.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, `simli-client` 3.x.

## How it works

```
Browser                                   Your Next.js server              Third parties
───────                                   ───────────────────              ─────────────
1. POST /api/simli-token  ─────────────▶  SIMLI_API_KEY ─────────────────▶ Simli: session token
   new SimliClient(token).start()  ◀───── session_token
   (avatar on screen)
2. POST /api/elevenlabs-signed-url ────▶  ELEVENLABS_API_KEY ────────────▶ ElevenLabs: signed URL
   WebSocket(signed_url)  ◀────────────── signed_url
3. mic ─ PCM16 ─▶ ElevenLabs agent ─ PCM16 16 kHz audio ─▶ simliClient.sendAudioData()
                                                          ─▶ Simli video + in-sync voice
```

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
| `SIMLI_FACE_ID` | no | Defaults to the Trinity-2 preset **Anna** (`bf13113a-355a-4d97-8b90-4edccd1da7b2`). Other [presets](https://docs.simli.com/api-reference/preset-faces), or your own avatars in the dashboard |
| `ELEVENLABS_API_KEY` | yes | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys). Needs access to ElevenAgents (Agents Platform) |
| `ELEVENLABS_AGENT_ID` | yes | Your agent's ID (`agent_...`), from [ElevenLabs Agents](https://elevenlabs.io/app/agents) |
| `ALLOW_UNAUTHENTICATED_SESSIONS` | no | Production only. Leave unset/`false`: in production both session routes return 403 until you add your own auth. `true` is only for demos and internal deploys. Ignored by `npm run dev` |

All of them are read on the server only. Don't rename them to `NEXT_PUBLIC_*`: that would ship them to every visitor's browser. If a variable is missing, the dev server tells you which one when you click **Test Interaction** (production builds only return a generic message and log the detail on the server).

### 2. Configure the ElevenLabs agent

In the ElevenLabs dashboard, on your agent:

1. **TTS output format: PCM 16000 Hz** (`pcm_16000`, in the agent's voice / advanced audio settings). Simli needs raw 16 kHz PCM. If the agent uses another format the app stops with a message telling you so.
2. **User input format:** leave it as PCM (16000 Hz recommended). The app reads the format from the agent and captures the mic at that rate.
3. **First message:** set a short greeting, so the avatar starts talking as soon as the conversation opens.
4. **Authentication (recommended): enable authentication** for the agent (Security settings, `platform_settings.auth.enable_auth`). This app always connects with a signed URL from the server, so it keeps working, and nobody can talk to your agent with just its ID. Per ElevenLabs' docs, use either signed URLs or a hostname allowlist on an agent, not both.
5. **Limits (Security settings):** set concurrent-call and daily-call limits and a maximum conversation duration. These are the only server-side cap on ElevenLabs spend: Simli's 600 s limit closes the agent socket only in an honest browser running this app.
6. **Keep client overrides disabled** (system prompt, first message, voice, language) unless you validate them. Whoever holds a signed URL controls the `conversation_initiation_client_data` message and could otherwise rewrite your agent's prompt or voice.

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
- **Session limits and framing:** `app/api/simli-token/route.ts` (`maxSessionLength`, `maxIdleTime`, `streaming_width` / `streaming_height`). The stream is square (768x768) to match the 350x350 player in `app/Components/VideoBox.tsx`. For a 16:9 layout use `1366x768` and change the player to `aspect-video`. See [Trinity-2 framing](https://docs.simli.com/api-reference/trinity-2).
- **Agent behaviour** (prompt, voice, LLM, tools): in the ElevenLabs dashboard.

## Before you deploy

Both API routes spend money (Simli minutes, ElevenLabs credits).

**What the server enforces as shipped**
- In production (`NODE_ENV=production`, i.e. `next start` or Vercel) `POST /api/simli-token` and `POST /api/elevenlabs-signed-url` return **403** unless `ALLOW_UNAUTHENTICATED_SESSIONS=true`. That flag turns them into open endpoints: only use it for demos or internal deploys.
- Each Simli session is capped by Simli itself: `maxSessionLength` 600 s and `maxIdleTime` 180 s, set in the token.
- Production error responses are generic; details are only in the server log.
- Upstream calls time out after 10 s. Security headers (`frame-ancestors 'self'`, microphone limited to this origin, `nosniff`, `strict-origin-when-cross-origin`) are set in `next.config.ts`.

**What is not capped**
- There is **no auth and no rate limiting**: the number of sessions per user, per IP or per day is unlimited. Replace the `ALLOW_UNAUTHENTICATED_SESSIONS` check with your own (the `TODO` in each route): require a signed-in user and limit sessions per user / IP.
- The ElevenLabs conversation length is **not** enforced by this app's server. The browser closes the socket when the Simli session ends, but a client that keeps the signed URL can talk for as long as the agent allows.

**Set provider-side limits**
- ElevenLabs agent Security settings: concurrent-call and daily-call limits, and a maximum conversation duration. Keep client overrides disabled (see Setup).
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
| "output audio format is ..." | Set the agent's TTS output format to PCM 16000 Hz |
| ElevenLabs `401` / `404` | Check `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` |
| Avatar talks over you | Use headphones |
| `Too Many Retry Attempts` | Your network blocks Simli's media servers (VPN / firewall) |

More: [Simli docs](https://docs.simli.com) · [Discord](https://discord.gg/yQx49zNF4d)

## Upgrading from the previous version

The environment variables changed, and the keys moved to the server:

| Before | Now |
|---|---|
| `NEXT_PUBLIC_SIMLI_API_KEY` | `SIMLI_API_KEY` |
| `NEXT_PUBLIC_SIMLI_FACE_ID` | `SIMLI_FACE_ID` |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | `ELEVENLABS_AGENT_ID` |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` (unchanged) |

`.env_sample` is now `.env.example`, and `.env.local` is the recommended file. In production the session routes return 403 until you add auth (or set `ALLOW_UNAUTHENTICATED_SESSIONS=true` for a demo). If you deployed the old version, rotate your Simli API key (and your ElevenLabs key if `NEXT_PUBLIC_ELEVENLABS_API_KEY` was ever set): they were readable by anyone who loaded the page.
