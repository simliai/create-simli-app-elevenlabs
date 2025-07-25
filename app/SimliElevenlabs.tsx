import React, { useCallback, useRef, useState, useEffect } from "react";
import { SimliClient } from "simli-client";
import VideoBox from "./Components/VideoBox";
import cn from "./utils/TailwindMergeAndClsx";
import IconSparkleLoader from "@/media/IconSparkleLoader";
import { getElevenLabsSignedUrl } from "./actions/actions";

interface SimliElevenlabsProps {
  simli_faceid: string;
  agentId: string;
  onStart: () => void;
  onClose: () => void;
  showDottedFace: boolean;
}

// WebSocket event types
type ElevenLabsWebSocketEvent =
  | {
      type: "user_transcript";
      user_transcription_event: { user_transcript: string };
    }
  | { type: "agent_response"; agent_response_event: { agent_response: string } }
  | { type: "audio"; audio_event: { audio_base_64: string; event_id: number } }
  | { type: "interruption"; interruption_event: { reason: string } }
  | { type: "ping"; ping_event: { event_id: number; ping_ms?: number } };

const simliClient = new SimliClient();

const SimliElevenlabs: React.FC<SimliElevenlabsProps> = ({
  simli_faceid,
  agentId,
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
  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  /**
   * Initializes the Simli client with the provided configuration.
   */
  const initializeSimliClient = useCallback(() => {
    if (videoRef.current && audioRef.current) {
      const SimliConfig = {
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
        faceID: simli_faceid,
        handleSilence: true,
        videoRef: videoRef.current,
        audioRef: audioRef.current,
      };

      simliClient.Initialize(SimliConfig as any);
      console.log("Simli Client initialized");
    }
  }, [simli_faceid]);

  /**
   * Converts base64 audio to Uint8Array for Simli
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
   * Converts Float32Array to base64 encoded PCM for ElevenLabs
   */
  const float32ToBase64PCM = (float32Array: Float32Array): string => {
    // Convert float32 to 16-bit PCM
    const pcmArray = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp values between -1 and 1, then convert to 16-bit range
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      pcmArray[i] = Math.floor(clamped * 32767);
    }
    
    // Convert to base64 using ArrayBuffer
    const arrayBuffer = pcmArray.buffer;
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Use btoa with proper binary string conversion
    let binaryString = '';
    const chunkSize = 8192; // Process in chunks to avoid stack overflow
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    return btoa(binaryString);
  };

  /**
   * Sends audio data to WebSocket
   */
  const sendAudioToWebSocket = (audioData: string) => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(
        JSON.stringify({
          user_audio_chunk: audioData,
        })
      );
    }
  };

  /**
   * Sends message to WebSocket
   */
  const sendMessage = (websocket: WebSocket, message: object) => {
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify(message));
    }
  };

  /**
   * Sets up voice streaming using Web Audio API for real-time processing
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

      // Create AudioContext for real-time processing
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioContext;

      // Create audio source from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create ScriptProcessorNode for real-time audio processing
      const bufferSize = 4096; // Buffer size in samples
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      let isProcessing = false;

      // Process audio in real-time
      processor.onaudioprocess = (event) => {
        if (isProcessing || !websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        isProcessing = true;
        
        try {
          const inputBuffer = event.inputBuffer;
          const inputData = inputBuffer.getChannelData(0); // Get mono channel

          // Only send if we have meaningful audio data (not silence)
          const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
          
          if (hasAudio) {
            // Convert audio data to base64 PCM and send to WebSocket
            const base64Audio = float32ToBase64PCM(inputData);
            sendAudioToWebSocket(base64Audio);
          }
        } catch (error) {
          console.error("Error processing audio:", error);
        } finally {
          isProcessing = false;
        }
      };

      // Connect the audio processing chain
      source.connect(processor);
      processor.connect(audioContext.destination);

      console.log("Voice streaming started with Web Audio API");
    } catch (error) {
      console.error("Failed to setup voice stream:", error);
      throw error;
    }
  };

  /**
   * Stops voice streaming
   */
  const stopVoiceStream = () => {
    // Disconnect and clean up audio nodes
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    console.log("Voice streaming stopped");
  };

  /**
   * Establishes WebSocket connection to ElevenLabs
   */
  const connectToElevenLabs = async () => {
    try {
      // Get signed URL for the agent first
      const signedUrl = await getElevenLabsSignedUrl(agentId);
      console.log("Got ElevenLabs signed URL");

      // Create WebSocket connection
      const websocket = new WebSocket(signedUrl);
      websocketRef.current = websocket;

      websocket.onopen = async () => {
        console.log("ElevenLabs WebSocket connected");

        // Send conversation initiation with proper format
        sendMessage(websocket, {
          type: "conversation_initiation_client_data",
          conversation_initiation_client_data: {
            custom_llm_extra_body: {}
          }
        });

        // Setup voice streaming after WebSocket is connected
        await setupVoiceStream();

        setIsAvatarVisible(true);
        setIsLoading(false);
      };

      websocket.onmessage = async (event) => {
        const data = JSON.parse(event.data) as ElevenLabsWebSocketEvent;

        // Handle ping events to keep connection alive
        if (data.type === "ping") {
          setTimeout(() => {
            sendMessage(websocket, {
              type: "pong",
              event_id: data.ping_event.event_id,
            });
          }, data.ping_event.ping_ms || 0);
        }

        // Handle user transcript
        if (data.type === "user_transcript") {
          console.log(
            "User transcript:",
            data.user_transcription_event.user_transcript
          );
        }

        // Handle agent response
        if (data.type === "agent_response") {
          console.log(
            "Agent response:",
            data.agent_response_event.agent_response
          );
        }

        // Handle audio data - THIS IS THE KEY PART
        if (data.type === "audio") {
          const { audio_base_64 } = data.audio_event;

          // Convert base64 audio to Uint8Array and send to Simli
          const audioData = base64ToUint8Array(audio_base_64);

          // Send audio data to Simli client
          if (simliClient) {
            simliClient.sendAudioData(audioData);
            console.log("Sent audio data to Simli:", audioData.length, "bytes");
          }
        }

        // Handle interruption
        if (data.type === "interruption") {
          console.log(
            "Conversation interrupted:",
            data.interruption_event.reason
          );
        }
      };

      websocket.onclose = (event) => {
        console.log("ElevenLabs WebSocket disconnected", event.code, event.reason);
        setIsAvatarVisible(false);
        stopVoiceStream();
        handleStop();
        websocketRef.current = null;
      };

      websocket.onerror = (error) => {
        console.error("ElevenLabs WebSocket error:", error);
        setError("WebSocket connection failed");
        setIsLoading(false);
      };
    } catch (error) {
      console.error("Failed to connect to ElevenLabs:", error);
      setError(`Failed to connect: ${error}`);
      setIsLoading(false);
    }
  };

  /**
   * Handles the start of the interaction
   */
  const handleStart = useCallback(async () => {
    initializeSimliClient();

    if (simliClient) {
      simliClient?.on("connected", () => {
        console.log("SimliClient connected");

        // Send initial audio data to establish connection
        const audioData = new Uint8Array(6000).fill(0);
        simliClient?.sendAudioData(audioData);
        console.log("Sent initial audio data to Simli");

        // Start ElevenLabs WebSocket connection
        connectToElevenLabs();
      });

      simliClient?.on("disconnected", () => {
        console.log("SimliClient disconnected");
      });
    }

    setIsLoading(true);
    setError("");
    onStart();

    try {
      // Start Simli client
      await simliClient?.start();
    } catch (error: any) {
      console.error("Error starting interaction:", error);
      setError(`Error starting interaction: ${error.message}`);
      setIsLoading(false);
    }
  }, [agentId, onStart]);

  /**
   * Handles stopping the interaction
   */
  const handleStop = useCallback(() => {
    console.log("Stopping interaction...");
    setIsLoading(false);
    setError("");
    setIsAvatarVisible(false);

    // Close WebSocket connection
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }

    // Stop voice streaming
    stopVoiceStream();

    // Clean up Simli client
    simliClient?.ClearBuffer();
    simliClient?.close();

    onClose();
    console.log("Interaction stopped");
  }, [onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      stopVoiceStream();
      simliClient?.close();
    };
  }, []);

  return (
    <>
      <div
        className={`transition-all duration-300 ${
          showDottedFace ? "h-0 overflow-hidden" : "h-auto"
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