"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogLevel, SimliClient } from "simli-client";
import IconSparkleLoader from "@/media/IconSparkleLoader";
import VideoBox from "./Components/VideoBox";
import { base64ToBytes, bytesToBase64, pcmRate, startMicCapture, type MicCapture } from "./utils/audio";
import { explainSimliError } from "./utils/explainSimliError";
import cn from "./utils/TailwindMergeAndClsx";

interface SimliElevenlabsProps {
  onStart: () => void;
  onClose: () => void;
  showDottedFace: boolean;
}

type Status = "idle" | "starting" | "live";

// The ElevenLabs Agents WebSocket messages this app handles.
// https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
type ElevenLabsServerEvent =
  | {
      type: "conversation_initiation_metadata";
      conversation_initiation_metadata_event: {
        conversation_id: string;
        agent_output_audio_format: string;
        user_input_audio_format: string;
      };
    }
  | { type: "audio"; audio_event: { audio_base_64?: string; event_id: number } }
  | { type: "interruption"; interruption_event: { reason?: string } }
  | { type: "ping"; ping_event: { event_id: number; ping_ms?: number } }
  | { type: "client_error"; error_event: { code: number; error_name: string; message?: string } }
  | { type: string };

async function errorText(res: Response) {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? JSON.stringify(j);
  } catch {
    return res.statusText;
  }
}

/**
 * Simli avatar driven by an ElevenLabs Agents conversation.
 *
 * Order: Simli session first (start() resolves when the avatar is on screen), then the
 * ElevenLabs WebSocket, then the microphone. Agent audio is sent to Simli only and is never
 * played directly: the user hears Simli's lip-synced voice through <audio> in VideoBox.
 * Ending either side (button, agent hang-up, Simli max length / idle, error, unmount,
 * pagehide) ends both.
 */
export default function SimliElevenlabs({ onStart, onClose, showDottedFace }: SimliElevenlabsProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const simliRef = useRef<SimliClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  // Bumped by every start and every cleanup, so a start that is still awaiting can tell it was cancelled.
  const sessionRef = useRef(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** Tears everything down. Idempotent: errors, close events and the End button can all call it. */
  const cleanup = useCallback(() => {
    sessionRef.current++;
    micRef.current?.stop();
    micRef.current = null;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);

    const simli = simliRef.current;
    simliRef.current = null;
    if (simli) void simli.stop();

    setSpeaking(false);
    setStatus("idle");
    onCloseRef.current();
  }, []);

  const fail = useCallback(
    (msg: string) => {
      console.error(msg);
      setError(msg);
      cleanup();
    },
    [cleanup],
  );

  const handleStart = useCallback(async () => {
    // Runs from a click, so the browser allows audio playback.
    const session = ++sessionRef.current;
    const cancelled = () => sessionRef.current !== session;
    setError("");
    setStatus("starting");
    onStart();

    try {
      // 1. Simli first: the avatar must be ready before the agent says anything.
      const tokenRes = await fetch("/api/simli-token", { method: "POST" });
      if (!tokenRes.ok) throw new Error(explainSimliError(`Simli token route failed (${tokenRes.status}): ${await errorText(tokenRes)}`));
      const { session_token } = (await tokenRes.json()) as { session_token: string };
      if (cancelled()) return;

      const simli = new SimliClient(session_token, videoRef.current!, audioRef.current!, null, LogLevel.ERROR);
      simli.on("error", (detail) => fail(explainSimliError(`Simli error: ${detail}`)));
      simli.on("stop", () => {
        // Simli ended the session (maxSessionLength / maxIdleTime / connection lost): end the conversation too.
        if (simliRef.current === simli) cleanup();
      });
      simli.on("speaking", () => setSpeaking(true));
      simli.on("silent", () => setSpeaking(false));
      simli.on("destination", (info) => console.info("Simli session:", info));
      simliRef.current = simli;
      await simli.start(); // resolves when the first video frame is on screen
      if (cancelled()) return;

      // 2. Now the ElevenLabs agent. Its first message (greeting) arrives right after connecting.
      const urlRes = await fetch("/api/elevenlabs-signed-url", { method: "POST" });
      if (!urlRes.ok) throw new Error(`ElevenLabs signed URL route failed (${urlRes.status}): ${await errorText(urlRes)}`);
      const { signed_url } = (await urlRes.json()) as { signed_url: string };
      if (cancelled()) return;

      const ws = new WebSocket(signed_url);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return;
        // Malformed or unexpected events are logged and ignored instead of throwing.
        try {
          if (typeof ev.data !== "string") throw new Error("non-text frame");
          const msg = JSON.parse(ev.data) as ElevenLabsServerEvent;
          if (!msg || typeof msg !== "object") throw new Error("not an object");
          handleEvent(msg);
        } catch (e) {
          console.warn("Ignoring malformed ElevenLabs event:", e);
        }
      };
      const handleEvent = (msg: ElevenLabsServerEvent) => {
        switch (msg.type) {
          case "conversation_initiation_metadata": {
            const meta = (msg as Extract<ElevenLabsServerEvent, { type: "conversation_initiation_metadata" }>)
              .conversation_initiation_metadata_event;
            if (!meta) throw new Error("conversation_initiation_metadata without event body");
            if (meta.agent_output_audio_format !== "pcm_16000") {
              fail(
                `The ElevenLabs agent's output audio format is "${meta.agent_output_audio_format}". ` +
                  "Simli needs PCM 16000 Hz: set the agent's TTS output format to PCM 16000 Hz in the ElevenLabs dashboard.",
              );
              return;
            }
            const inputRate = pcmRate(meta.user_input_audio_format);
            if (!inputRate) {
              fail(`Unsupported ElevenLabs user input audio format "${meta.user_input_audio_format}". Use a PCM format (16000 Hz recommended).`);
              return;
            }
            // 3. Stream the microphone to the agent, in the format the agent expects.
            startMicCapture(inputRate, (pcm) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
              ws.send(JSON.stringify({ user_audio_chunk: bytesToBase64(bytes) }));
            })
              .then((mic) => {
                if (wsRef.current !== ws) return mic.stop(); // ended while the mic was opening
                micRef.current = mic;
                setStatus("live");
              })
              .catch((e: unknown) =>
                fail(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}. Allow mic access and try again.`),
              );
            break;
          }
          case "audio": {
            // Agent speech (PCM16 16 kHz) goes to Simli only; Simli plays it back in sync with the video.
            const b64 = (msg as Extract<ElevenLabsServerEvent, { type: "audio" }>).audio_event?.audio_base_64;
            if (typeof b64 === "string" && b64) simliRef.current?.sendAudioData(base64ToBytes(b64));
            break;
          }
          case "interruption":
            // The user barged in: drop what the avatar hasn't said yet.
            simliRef.current?.ClearBuffer();
            break;
          case "ping": {
            const { event_id } = (msg as Extract<ElevenLabsServerEvent, { type: "ping" }>).ping_event ?? {};
            if (event_id === undefined) throw new Error("ping without event_id");
            ws.send(JSON.stringify({ type: "pong", event_id }));
            break;
          }
          case "client_error": {
            const e = (msg as Extract<ElevenLabsServerEvent, { type: "client_error" }>).error_event ?? {};
            fail(`ElevenLabs error ${e.code ?? "?"} (${e.error_name ?? "unknown"})${e.message ? `: ${e.message}` : ""}`);
            break;
          }
        }
      };
      ws.onclose = (ev) => {
        if (wsRef.current !== ws) return; // we closed it ourselves
        wsRef.current = null;
        // The conversation ended on the agent's side: end the Simli session too.
        if (ev.code !== 1000) setError(`ElevenLabs closed the conversation (code ${ev.code})${ev.reason ? `: ${ev.reason}` : "."}`);
        cleanup();
      };

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error("Could not connect to ElevenLabs.")), { once: true });
        ws.addEventListener("close", () => reject(new Error("ElevenLabs closed the connection.")), { once: true });
      });
      if (cancelled()) return;
      ws.onerror = () => fail("ElevenLabs connection error.");
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    } catch (e) {
      if (!cancelled()) fail(explainSimliError(e instanceof Error ? e.message : String(e)));
    }
  }, [cleanup, fail, onStart]);

  // Stop everything on unmount and when the tab is closed, so sessions don't keep billing.
  useEffect(() => {
    const onHide = () => {
      if (simliRef.current || wsRef.current) cleanup();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [cleanup]);

  return (
    <>
      <div className={`transition-all duration-300 ${showDottedFace ? "h-0 overflow-hidden" : "h-auto"}`}>
        <VideoBox videoRef={videoRef} audioRef={audioRef} />
      </div>
      <div className="flex flex-col items-center w-full max-w-[350px] mx-auto">
        {error && (
          <div role="alert" className="mt-4 max-w-[350px] p-2 bg-red-100 border border-red-400 text-red-700 rounded-sm">
            {error}
          </div>
        )}
        {status === "idle" ? (
          <button
            onClick={handleStart}
            className={cn(
              "w-full h-[52px] mt-4 bg-simliblue text-white py-3 px-6 rounded-[100px] transition-all duration-300 hover:text-black hover:bg-white hover:rounded-sm",
              "flex justify-center items-center",
            )}
          >
            <span className="font-abc-repro-mono font-bold w-[164px]">Test Interaction</span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 w-full">
            <button
              onClick={cleanup}
              className="mt-4 group text-white w-full bg-red hover:rounded-sm hover:bg-white h-[52px] px-6 rounded-[100px] transition-all duration-300 flex justify-center items-center"
            >
              {status === "starting" ? (
                <IconSparkleLoader className="h-[20px] animate-loader" />
              ) : (
                <span className="font-abc-repro-mono group-hover:text-black font-bold w-[164px] transition-all duration-300">
                  Stop Interaction
                </span>
              )}
            </button>
            <span className="font-abc-repro-mono text-xs text-gray-400" aria-live="polite">
              {status === "starting" ? "Connecting…" : speaking ? "Agent is speaking…" : "Listening…"}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
