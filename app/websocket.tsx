type BaseEvent = {
    type: string;
  };
  
  type UserTranscriptEvent = BaseEvent & {
    type: "user_transcript";
    user_transcription_event: {
      user_transcript: string;
    };
  };
  
  type AgentResponseEvent = BaseEvent & {
    type: "agent_response";
    agent_response_event: {
      agent_response: string;
    };
  };
  
  type AudioResponseEvent = BaseEvent & {
    type: "audio";
    audio_event: {
      audio_base_64: string;
      event_id: number;
    };
  };
  
  type InterruptionEvent = BaseEvent & {
    type: "interruption";
    interruption_event: {
      reason: string;
    };
  };
  
  type PingEvent = BaseEvent & {
    type: "ping";
    ping_event: {
      event_id: number;
      ping_ms?: number;
    };
  };
  
  export type ElevenLabsWebSocketEvent =
    | UserTranscriptEvent
    | AgentResponseEvent
    | AudioResponseEvent
    | InterruptionEvent
    | PingEvent;
  