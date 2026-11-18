import "server-only";

/**
 * Customize your avatar's agent here.
 *
 * This file is server-only. Unless ELEVENLABS_AGENT_ID is set, the server creates an
 * ElevenLabs agent from these settings the first time someone clicks "Test Interaction",
 * and updates that same agent whenever this file changes (see lib/elevenlabsAgent.ts).
 * The browser never sees or changes the prompt, voice or model.
 *
 * Edits made to the agent in the ElevenLabs dashboard are kept until you change this
 * file; the next sync then overwrites the fields set here.
 *
 * The avatar's face is set with SIMLI_FACE_ID in .env.local (default: Simli's default
 * Trinity-2 face, a woman, so the voice is a female one). If you change the face, change
 * the name and voice to match.
 */
export const avatar = {
  // Shown in the ElevenLabs dashboard as "<name> (Simli starter)".
  name: "Assistant",

  // ElevenLabs voice. Both are from ElevenLabs' replacement set for its old Default voices
  // ("What are Default voices?" in the ElevenLabs help center), which ElevenLabs says stay
  // available permanently:
  //   Female: "OZ0L6eISlOejga3XjDFt"  Talia - Warm Soft Guide  (replaces Sarah)
  //   Male:   "l7kNoIfnJKPg7779LI2t"  Eddie - Natural and Helpful  (replaces Eric)
  // The old Default voices (e.g. Sarah EXAVITQu4vr4xnSDxMaL) only exist on accounts created
  // before March 2026 and expire on 31 Dec 2026, so don't use them here.
  // Any voice ID from https://elevenlabs.io/app/voice-library works, if your plan allows it.
  elevenlabs_voice_id: "OZ0L6eISlOejga3XjDFt",
  // If that voice isn't on your account (ElevenLabs' default voices differ between older and
  // newer accounts), the server uses one of your account's default voices of this gender.
  voice_gender: "female" as "female" | "male",

  // Language code for speech recognition and TTS ("en", "es", "de", ...).
  language: "en",

  // LLM behind the agent. ElevenLabs passes LLM costs through at the provider's rate,
  // deducted from your credits (also on the free plan). Flash-Lite models are Google's
  // cheapest tier; "gemini-3.5-flash" (ElevenLabs' default) is smarter and costs more.
  // Compare prices under Primary LLM -> "Detailed costs" in the agent's dashboard page.
  llm: "gemini-3.5-flash-lite",

  // What the agent says as soon as the conversation opens.
  firstMessage: "Hi there! How can I help you today?",

  initialPrompt:
    "You are a helpful AI assistant, shown to the user as a video avatar. " +
    "You are friendly and concise. Your answers are short and to the point: this is a spoken conversation, " +
    "so never use lists, markdown or long explanations.",

  // Provider-side caps on the agent, enforced by ElevenLabs (not by this app).
  // The free plan allows 4 concurrent calls per account.
  limits: {
    maxConcurrentConversations: 4,
    maxConversationsPerDay: 100,
  },
} as const;

export type AvatarConfig = typeof avatar;
