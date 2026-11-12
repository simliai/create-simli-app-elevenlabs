import type { RefObject } from "react";

interface VideoBoxProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
}

/**
 * 16:9 player for the Simli stream (the token route requests 1366x768).
 * For a square layout, request 768x768 in app/api/simli-token/route.ts and use aspect-square here.
 */
export default function VideoBox({ videoRef, audioRef }: VideoBoxProps) {
  return (
    <div className="aspect-video w-full flex rounded-sm overflow-hidden items-center justify-center bg-simligray">
      {/* muted: the voice plays from the <audio> below, which is Simli's lip-synced audio */}
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
