import React, { useCallback, useRef, useState, useEffect } from "react";
import { generateSimliSessionToken, LogLevel, SimliClient } from "simli-client";
import VideoBox from "./Components/VideoBox";
import cn from "./utils/TailwindMergeAndClsx";
import IconSparkleLoader from "@/media/IconSparkleLoader";
import {
    getElevenLabsSignedUrl,
    get60dbSttWebSocketUrl,
    get60dbTtsWebSocketUrl,
} from "./actions/actions";

interface SimliElevenlabsProps {
    simli_faceid: string;
    agentId: string;
    sixtyDbVoiceId: string;
    onStart: () => void;
    onClose: () => void;
    showDottedFace: boolean;
}

let simliClient: SimliClient | null = null;

/**
 * Audio pipeline overview
 * ------------------------
 * Voice is handled entirely by 60db; ElevenLabs is used as the LLM/agent brain only.
 *
 *   Mic (PCM linear16 @16kHz)
 *      └─► 60db STT WebSocket            -> transcription events (user text)
 *              └─► ElevenLabs ConvAI WS  -> agent_response events (agent text)
 *                      └─► 60db TTS WS   -> audio_chunk events (PCM linear16 @16kHz)
 *                              └─► simliClient.sendAudioData() -> lip-synced avatar
 *
 * Every leg uses LINEAR16 @ 16kHz, so the same base64<->PCM helpers are reused
 * for both the mic-in (STT) and avatar-out (TTS) directions.
 */

// ElevenLabs ConvAI WebSocket events we care about (text/control only — its
// own `audio` events are intentionally ignored since 60db produces the voice).
type ElevenLabsWebSocketEvent =
    | { type: "agent_response"; agent_response_event: { agent_response: string } }
    | { type: "user_transcript"; user_transcription_event: { user_transcript: string } }
    | { type: "interruption"; interruption_event: { reason: string } }
    | { type: "audio"; audio_event: { audio_base_64: string; event_id: number } }
    | { type: "ping"; ping_event: { event_id: number; ping_ms?: number } };

// 60db STT WebSocket server -> client events.
type SixtyDbSttEvent =
    | { connecting: boolean }
    | { connection_established: Record<string, unknown> }
    | { type: "connected"; server_info?: Record<string, unknown> }
    | { type: "speech_started"; timestamp: number }
    | {
        type: "transcription";
        text: string;
        is_final: boolean;
        speech_final: boolean;
        is_partial?: boolean;
        language?: string;
    }
    | { type: "session_stopped"; billing_summary?: Record<string, unknown> }
    | { type: "error"; error: string };

// 60db TTS WebSocket server -> client events (envelope-keyed, not `type`-tagged).
type SixtyDbTtsEvent =
    | { connection_established: Record<string, unknown> }
    | { context_created: { context_id: string } }
    | { audio_chunk: { context_id: string; audioContent: string } }
    | { flush_completed: { context_id: string } }
    | { context_closed: { context_id: string } }
    | { error: { context_id?: string; message: string } };

const SimliElevenlabs: React.FC<SimliElevenlabsProps> = ({
    simli_faceid,
    agentId,
    sixtyDbVoiceId,
    onStart,
    onClose,
    showDottedFace,
}) => {
    // State management
    const [isLoading, setIsLoading] = useState(false);
    const [isAvatarVisible, setIsAvatarVisible] = useState(false);
    const [error, setError] = useState("");

    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // The three WebSockets
    const elevenLabsWsRef = useRef<WebSocket | null>(null); // LLM/agent brain
    const sttWsRef = useRef<WebSocket | null>(null); // 60db speech-to-text
    const ttsWsRef = useRef<WebSocket | null>(null); // 60db text-to-speech

    // The TTS context whose audio is currently allowed to reach Simli. On a
    // barge-in we null this so any in-flight chunks from the old turn are dropped.
    const ttsActiveContextRef = useRef<string | null>(null);

    // Mic capture chain
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    /* --------------------------------------------------------------------- */
    /* Audio helpers                                                          */
    /* --------------------------------------------------------------------- */

    /**
     * Converts base64 (LINEAR16 PCM) coming from 60db into a Uint8Array for Simli.
     */
    const base64ToUint8Array = (base64: string): Uint8Array => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    };

    /**
     * Converts Float32 mic samples to base64-encoded 16-bit PCM for 60db STT.
     */
    const float32ToBase64PCM = (float32Array: Float32Array): string => {
        const pcmArray = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const clamped = Math.max(-1, Math.min(1, float32Array[i]));
            pcmArray[i] = Math.floor(clamped * 32767);
        }

        const uint8Array = new Uint8Array(pcmArray.buffer);

        let binaryString = "";
        const chunkSize = 8192; // chunk to avoid call-stack overflow in apply()
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, Array.from(chunk));
        }

        return btoa(binaryString);
    };

    /**
     * Sends a JSON message over a WebSocket if it is open.
     */
    const sendMessage = (websocket: WebSocket | null, message: object) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify(message));
        }
    };

    /* --------------------------------------------------------------------- */
    /* Simli client                                                          */
    /* --------------------------------------------------------------------- */

    /**
     * Initializes the Simli client and, once connected, opens all the
     * downstream sockets (ElevenLabs brain + 60db STT/TTS).
     */
    const initializeSimliClient = useCallback(async () => {
        if (videoRef.current && audioRef.current) {
            const SimliConfig = {
                faceId: simli_faceid,
                maxIdleTime: 600,
                maxSessionLength: 600,
                handleSilence: true,
            };

            simliClient = new SimliClient(
                (
                    await generateSimliSessionToken({
                        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY as string,
                        config: SimliConfig,
                    })
                ).session_token,
                videoRef.current,
                audioRef.current,
                null,
                LogLevel.DEBUG,
                "livekit",
            );

            simliClient.on("start", async () => {
                console.log("SimliClient connected");

                // Prime the connection with a short burst of silence.
                const audioData = new Uint8Array(6000).fill(0);
                simliClient?.sendAudioData(audioData);

                // Bring up the brain and the voice sockets.
                await connectToElevenLabs();
                await connectTo60dbTts();
                await connectTo60dbStt();
            });

            simliClient.on("stop", () => console.log("SimliClient disconnected"));
            simliClient.on("error", () => console.log("SimliClient Errored out"));
            simliClient.on("startup_error", () =>
                console.log("SimliClient failed to start"),
            );

            await simliClient.start();
        }
    }, [simli_faceid]);

    /* --------------------------------------------------------------------- */
    /* 60db TTS  (agent text -> avatar audio)                                 */
    /* --------------------------------------------------------------------- */

    /**
     * Synthesizes a piece of agent text through 60db and streams it to Simli.
     * Each utterance gets its own context_id so a barge-in can cleanly discard
     * any audio still arriving for the previous turn.
     */
    const speakWith60db = (text: string) => {
        const ws = ttsWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;

        const contextId = `ctx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        ttsActiveContextRef.current = contextId;

        // create -> send_text -> flush, processed in order by the server.
        sendMessage(ws, {
            create_context: {
                context_id: contextId,
                voice_id: sixtyDbVoiceId,
                audio_config: {
                    audio_encoding: "LINEAR16",
                    sample_rate_hertz: 16000,
                },
                speed: 1,
                stability: 50,
                similarity: 75,
            },
        });
        sendMessage(ws, { send_text: { context_id: contextId, text } });
        sendMessage(ws, { flush_context: { context_id: contextId } });
    };

    /**
     * Stops the avatar mid-utterance (barge-in): clear Simli's buffer and stop
     * accepting audio for the current TTS context.
     */
    const handleBargeIn = () => {
        ttsActiveContextRef.current = null;
        simliClient?.ClearBuffer();
    };

    /**
     * Opens the 60db TTS WebSocket.
     */
    const connectTo60dbTts = async () => {
        try {
            const url = await get60dbTtsWebSocketUrl();
            const ws = new WebSocket(url);
            ttsWsRef.current = ws;

            ws.onopen = () => console.log("60db TTS WebSocket connected");

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data) as SixtyDbTtsEvent;

                if ("audio_chunk" in data) {
                    const { context_id, audioContent } = data.audio_chunk;
                    // Drop audio from a turn that was interrupted.
                    if (context_id !== ttsActiveContextRef.current) return;

                    const audioData = base64ToUint8Array(audioContent);
                    simliClient?.sendAudioData(audioData);
                    return;
                }

                if ("error" in data) {
                    console.error("60db TTS error:", data.error.message);
                }
            };

            ws.onclose = (e) =>
                console.log("60db TTS WebSocket disconnected", e.code, e.reason);
            ws.onerror = (e) => console.error("60db TTS WebSocket error:", e);
        } catch (err) {
            console.error("Failed to connect to 60db TTS:", err);
            setError(`Failed to connect to 60db TTS: ${err}`);
        }
    };

    /* --------------------------------------------------------------------- */
    /* ElevenLabs ConvAI  (LLM / agent brain — text only)                     */
    /* --------------------------------------------------------------------- */

    /**
     * Opens the ElevenLabs ConvAI WebSocket. We only feed it user text and read
     * back agent text; its own STT/TTS are bypassed in favour of 60db.
     */
    const connectToElevenLabs = async () => {
        try {
            const signedUrl = await getElevenLabsSignedUrl(agentId);
            const websocket = new WebSocket(signedUrl);
            elevenLabsWsRef.current = websocket;

            websocket.onopen = () => {
                console.log("ElevenLabs WebSocket connected");
                sendMessage(websocket, {
                    type: "conversation_initiation_client_data",
                    conversation_initiation_client_data: {
                        custom_llm_extra_body: {},
                    },
                });
            };

            websocket.onmessage = (event) => {
                const data = JSON.parse(event.data) as ElevenLabsWebSocketEvent;

                // Keep-alive.
                if (data.type === "ping") {
                    setTimeout(() => {
                        sendMessage(websocket, {
                            type: "pong",
                            event_id: data.ping_event.event_id,
                        });
                    }, data.ping_event.ping_ms || 0);
                    return;
                }

                // Agent's text reply -> synthesize with 60db.
                if (data.type === "agent_response") {
                    const text = data.agent_response_event.agent_response;
                    console.log("Agent response:", text);
                    speakWith60db(text);
                    return;
                }

                // ElevenLabs-side interruption signal.
                if (data.type === "interruption") {
                    console.log("Interruption:", data.interruption_event.reason);
                    handleBargeIn();
                    return;
                }

                // `audio` and `user_transcript` events are ignored — voice is 60db's job.
            };

            websocket.onclose = (e) => {
                console.log("ElevenLabs WebSocket disconnected", e.code, e.reason);
                elevenLabsWsRef.current = null;
            };

            websocket.onerror = (err) => {
                console.error("ElevenLabs WebSocket error:", err);
                setError("ElevenLabs connection failed");
                setIsLoading(false);
            };
        } catch (err) {
            console.error("Failed to connect to ElevenLabs:", err);
            setError(`Failed to connect: ${err}`);
            setIsLoading(false);
        }
    };

    /**
     * Forwards a finalized user transcript to the ElevenLabs agent as text.
     */
    const sendUserTextToAgent = (text: string) => {
        sendMessage(elevenLabsWsRef.current, { type: "user_message", text });
    };

    /* --------------------------------------------------------------------- */
    /* 60db STT  (mic -> user text)                                           */
    /* --------------------------------------------------------------------- */

    /**
     * Opens the 60db STT WebSocket and starts mic capture once the session is
     * ready.
     */
    const connectTo60dbStt = async () => {
        try {
            const url = await get60dbSttWebSocketUrl();
            const ws = new WebSocket(url);
            sttWsRef.current = ws;

            ws.onopen = () => {
                console.log("60db STT WebSocket connected");
                sendMessage(ws, {
                    type: "start",
                    languages: null, // auto-detect
                    config: {
                        encoding: "linear",
                        sample_rate: 16000,
                        utterance_end_ms: 500,
                        continuous_mode: true,
                        interim_results_frequency: 300,
                        audio_enhancement: "adaptive",
                    },
                });
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data) as SixtyDbSttEvent;

                if ("type" in data && data.type === "connected") {
                    // Session is ready — start streaming the mic.
                    console.log("60db STT session ready");
                    simliClient?.ClearBuffer();
                    await setupVoiceStream();
                    setIsAvatarVisible(true);
                    setIsLoading(false);
                    return;
                }

                if ("type" in data && data.type === "speech_started") {
                    // User started talking -> barge-in over the avatar.
                    handleBargeIn();
                    return;
                }

                if ("type" in data && data.type === "transcription") {
                    // Act only on the canonical, final transcript per utterance.
                    if (data.speech_final && data.text.trim()) {
                        console.log("User said:", data.text);
                        sendUserTextToAgent(data.text);
                    }
                    return;
                }

                if ("type" in data && data.type === "error") {
                    console.error("60db STT error:", data.error);
                }
            };

            ws.onclose = (e) =>
                console.log("60db STT WebSocket disconnected", e.code, e.reason);
            ws.onerror = (err) => {
                console.error("60db STT WebSocket error:", err);
                setError("60db STT connection failed");
                setIsLoading(false);
            };
        } catch (err) {
            console.error("Failed to connect to 60db STT:", err);
            setError(`Failed to connect to 60db STT: ${err}`);
            setIsLoading(false);
        }
    };

    /**
     * Streams the user's microphone to the 60db STT socket as base64 PCM.
     */
    const setupVoiceStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            streamRef.current = stream;

            const audioContext = new (window.AudioContext ||
                (window as any).webkitAudioContext)({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            const bufferSize = 4096;
            const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
            processorRef.current = processor;

            // Stream continuously — 60db runs its own VAD/utterance detection, so
            // we must not gate out "silence" client-side or turn-end breaks.
            processor.onaudioprocess = (event) => {
                const ws = sttWsRef.current;
                if (!ws || ws.readyState !== WebSocket.OPEN) return;

                const inputData = event.inputBuffer.getChannelData(0);
                const base64Audio = float32ToBase64PCM(inputData);
                sendMessage(ws, {
                    type: "audio",
                    audio: base64Audio,
                    encoding: "linear",
                    sample_rate: 16000,
                    timestamp: Date.now(),
                });
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            console.log("Voice streaming to 60db STT started");
        } catch (err) {
            console.error("Failed to setup voice stream:", err);
            throw err;
        }
    };

    /**
     * Tears down the mic capture chain.
     */
    const stopVoiceStream = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current.onaudioprocess = null;
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        console.log("Voice streaming stopped");
    };

    /* --------------------------------------------------------------------- */
    /* Lifecycle                                                              */
    /* --------------------------------------------------------------------- */

    const handleStart = useCallback(async () => {
        setIsLoading(true);
        setError("");
        onStart();
        initializeSimliClient();
    }, [initializeSimliClient, onStart]);

    const handleStop = useCallback(() => {
        console.log("Stopping interaction...");
        setIsLoading(false);
        setError("");
        setIsAvatarVisible(false);

        // Tell 60db STT to finalize, then close all sockets.
        if (sttWsRef.current) {
            sendMessage(sttWsRef.current, { type: "stop" });
            sttWsRef.current.close();
            sttWsRef.current = null;
        }
        if (ttsWsRef.current) {
            ttsWsRef.current.close();
            ttsWsRef.current = null;
        }
        if (elevenLabsWsRef.current) {
            elevenLabsWsRef.current.close();
            elevenLabsWsRef.current = null;
        }

        ttsActiveContextRef.current = null;
        stopVoiceStream();

        simliClient?.stop();
        simliClient = null;

        onClose();
        console.log("Interaction stopped");
    }, [onClose]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            sttWsRef.current?.close();
            ttsWsRef.current?.close();
            elevenLabsWsRef.current?.close();
            stopVoiceStream();
            simliClient?.stop();
        };
    }, []);

    return (
        <>
            <div
                className={`transition-all duration-300 ${showDottedFace ? "h-0 overflow-hidden" : "h-auto"
                    }`}
            >
                <VideoBox video={videoRef} audio={audioRef} />
            </div>
            <div className="flex flex-col items-center">
                {error && (
                    <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
                        {error}
                    </div>
                )}
                {!isAvatarVisible ? (
                    <button
                        onClick={handleStart}
                        disabled={isLoading}
                        className={cn(
                            "w-full h-[52px] mt-4 disabled:bg-[#343434] disabled:text-white disabled:hover:rounded-[100px] bg-simliblue text-white py-3 px-6 rounded-[100px] transition-all duration-300 hover:text-black hover:bg-white hover:rounded-sm",
                            "flex justify-center items-center"
                        )}
                    >
                        {isLoading ? (
                            <IconSparkleLoader className="h-[20px] animate-loader" />
                        ) : (
                            <span className="font-abc-repro-mono font-bold w-[164px]">
                                Test Interaction
                            </span>
                        )}
                    </button>
                ) : (
                    <>
                        <div className="flex items-center gap-4 w-full">
                            <button
                                onClick={handleStop}
                                className={cn(
                                    "mt-4 group text-white flex-grow bg-red hover:rounded-sm hover:bg-white h-[52px] px-6 rounded-[100px] transition-all duration-300"
                                )}
                            >
                                <span className="font-abc-repro-mono group-hover:text-black font-bold w-[164px] transition-all duration-300">
                                    Stop Interaction
                                </span>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

export default SimliElevenlabs;
