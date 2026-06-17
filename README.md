# Create Simli App (60db + ElevenLabs)
This starter shows how to build a composable Simli avatar interaction in a Next.js app where **60db handles the voice layer** (speech-to-text + text-to-speech) and **ElevenLabs Conversational AI is used as the LLM/agent brain only**.

## Architecture
Voice in and voice out are both 60db; ElevenLabs only does the thinking.

```
Mic (PCM linear16 @16kHz)
   └─► 60db STT WebSocket            -> transcription (user text)
           └─► ElevenLabs ConvAI WS  -> agent_response (agent text)   [LLM brain only]
                   └─► 60db TTS WS    -> audio_chunk (PCM linear16 @16kHz)
                           └─► SimliClient.sendAudioData() -> lip-synced avatar
```

- The mic is streamed to **60db STT** (`wss://api.60db.ai/ws/stt`). When 60db emits a final transcript, the text is sent to the ElevenLabs agent.
- ElevenLabs runs the LLM and returns the agent's reply **as text** (`agent_response`). Its own audio output is ignored.
- That text is synthesized by **60db TTS** (`wss://api.60db.ai/ws/tts`) and the PCM audio is fed straight into Simli.
- Every leg uses `LINEAR16 @ 16kHz`, so audio flows between the services without resampling.
- **Barge-in:** when 60db STT detects the user starting to speak (`speech_started`), the avatar's buffer is cleared and the current TTS turn is dropped.

## Usage
1. Rename `.env_sample` to `.env` and paste your API keys:
   [SIMLI-API-KEY](https://www.simli.com/profile), [ELEVENLABS-API-KEY](https://elevenlabs.io/app/settings/api-keys), and your 60db API key.
```js
NEXT_PUBLIC_SIMLI_API_KEY = "SIMLI-API-KEY"
ELEVENLABS_API_KEY = "ELEVENLABS-API-KEY"
NEXT_PUBLIC_SIMLI_FACE_ID = "SIMLI-FACE-ID"
NEXT_PUBLIC_ELEVENLABS_AGENT_ID = "ELEVENLABS-AGENT-ID"

# 60db handles the voice layer (speech-to-text + text-to-speech).
SIXTYDB_API_KEY = "60DB-API-KEY"
NEXT_PUBLIC_60DB_VOICE_ID = "60DB-VOICE-ID"
```

| Variable | Used by | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SIMLI_API_KEY` | Simli session token | Yes |
| `ELEVENLABS_API_KEY` | ElevenLabs signed URL (server action) | No |
| `NEXT_PUBLIC_SIMLI_FACE_ID` | Avatar face | Yes |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | ElevenLabs agent (LLM brain) | Yes |
| `SIXTYDB_API_KEY` | 60db STT + TTS WebSocket URLs (server action) | No (in bundle); see note below |
| `NEXT_PUBLIC_60DB_VOICE_ID` | 60db TTS voice | Yes |

> Find a 60db voice id via the [Get My Voices](https://docs.60db.ai/api-reference/voices/get-my-voices) endpoint (`GET https://api.60db.ai/myvoices`).

2. Install packages
```bash
npm install
```

3. Run
```bash
npm run dev
```

4. Customize your avatar's face, agent, and voice by editing `.env` (or `app/page.tsx`). [Create your ElevenLabs agent](https://elevenlabs.io/app/conversational-ai/).
```js
const avatar = {
  elevenlabs_agentid: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID,
  simli_faceid: process.env.NEXT_PUBLIC_SIMLI_FACE_ID,
  sixtydb_voiceid: process.env.NEXT_PUBLIC_60DB_VOICE_ID,
};
```

## How the code is organized
- `app/page.tsx` — reads the avatar config (face id, agent id, 60db voice id) from env and renders the interaction.
- `app/SimliElevenlabs.tsx` — the orchestrator. Opens the three WebSockets (60db STT, ElevenLabs brain, 60db TTS), streams the mic, routes transcripts/responses/audio, and handles barge-in and teardown.
- `app/actions/actions.tsx` — server actions that keep API keys server-side: `getElevenLabsSignedUrl`, `get60dbSttWebSocketUrl`, `get60dbTtsWebSocketUrl`.

## Notes & caveats
- **60db key exposure:** 60db authenticates the WebSocket via an `apiKey` query parameter and has no token/signed-URL endpoint. The server action keeps the key out of the JS bundle, but it is still visible in the browser's network tab at runtime. For production, front it with a proxy.
- **ElevenLabs still generates (ignored) audio:** there is no documented text-only mode, so the agent produces TTS audio that this app discards. Functionally harmless, but you pay for it.
- **60db languages:** 60db supports English plus many Indian and European languages — useful if you need non-English voices.

## Characters
You can swap out the character by finding one you like in the [docs](https://docs.simli.com/introduction), or [create your own](https://app.simli.com/).

![alt text](media/image.png) ![alt text](media/image-4.png) ![alt text](media/image-2.png) ![alt text](media/image-3.png) ![alt text](media/image-5.png) ![alt text](media/image-6.png)

## Deploy on Vercel
An easy way to deploy your avatar interaction is the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).
