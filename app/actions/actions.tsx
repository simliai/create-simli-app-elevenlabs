'use server';

interface AgentConfig {
  name: string;
  conversation_config: {
    agent: {
      prompt: {
        prompt: string;
        llm: string;
        temperature: number;
        max_tokens: number;
      };
      first_message: string;
      language: string;
    };
    asr: {
      quality: string;
      provider: string;
      user_input_audio_format: string;
      keywords: string[];
    };
    turn: {
      turn_timeout: number;
      mode: string;
    };
    tts: {
      model_id: string;
      voice_id: string;
      agent_output_audio_format: string;
      optimize_streaming_latency: number;
      stability: number;
      similarity_boost: number;
    };
    conversation: {
      max_duration_seconds: number;
      client_events: string[];
    };
  };
  platform_settings: {
    auth: {
      enable_auth: boolean;
      allowlist: string[];
      shareable_token: string | null;
    };
  };
}

interface ElevenLabsAgentResponse {
  agent_id: string;
}

/**
 * Creates a new ElevenLabs agent with the specified configuration
 * @param config The configuration for the new agent
 * @returns Object containing the agent_id or error message
 */
export async function createElevenLabsAgent(
  config: AgentConfig
): Promise<{ agent_id: string } | { error: string }> {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key is not configured');
    }

    const requestHeaders = new Headers();
    requestHeaders.set('xi-api-key', process.env.ELEVENLABS_API_KEY);
    requestHeaders.set('Content-Type', 'application/json');

    const response = await fetch(
      'https://api.elevenlabs.io/v1/convai/agents/create',
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(config)
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const body = await response.json() as ElevenLabsAgentResponse;
    return { agent_id: body.agent_id };

  } catch (error) {
    console.error('Error creating ElevenLabs agent:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

interface ElevenLabsSignedUrlResponse {
  signed_url: string;
}

/**
 * Get ElevenLabs signed URL for the given agent ID
 * @param agentId 
 * @returns Object containing the signed URL or error message
 */
export async function getElevenLabsSignedUrl(agentId: string): Promise<string> {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key is not configured');
    }

    const requestHeaders = new Headers();
    requestHeaders.set('xi-api-key', process.env.ELEVENLABS_API_KEY);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: requestHeaders,
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const body = await response.json() as ElevenLabsSignedUrlResponse;
    return body.signed_url;

  } catch (error) {
    console.error('Error getting ElevenLabs signed URL:', error);
    throw new Error(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

interface ElevenLabsConversationTokenResponse {
  token: string;
}

/**
 * Get ElevenLabs signed URL for the given agent ID
 * @param agentId 
 * @returns Object containing the signed URL or error message
 */
export async function getElevenLabsConversationToken(agentId: string): Promise<string> {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key is not configured');
    }

    const requestHeaders = new Headers();
    requestHeaders.set('xi-api-key', process.env.ELEVENLABS_API_KEY);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
      {
        headers: requestHeaders,
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const body = await response.json() as ElevenLabsConversationTokenResponse;
    return body.token;

  } catch (error) {
    console.error('Error getting ElevenLabs conversation token:', error);
    throw new Error(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

