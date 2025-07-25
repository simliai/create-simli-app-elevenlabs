'use client';

import { useCallback } from 'react';
import { useAgentConversation } from './useAgentConversation';

export function Conversation() {
  const { startConversation, stopConversation, isConnected } = useAgentConversation();

  const handleStart = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await startConversation();
    } catch (error) {
      console.error('Failed to start conversation:', error);
    }
  }, [startConversation]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          disabled={isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          Start Conversation
        </button>
        <button
          onClick={stopConversation}
          disabled={!isConnected}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
        >
          Stop Conversation
        </button>
      </div>
      <div className="flex flex-col items-center">
        <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
      </div>
    </div>
  );
}
