import type { RefObject } from "react";

interface VideoBoxProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
}

/**
 * Square player for the Simli stream (the token route requests 768x768).
 * If you switch the stream to 16:9 (1366x768), change aspect-square to aspect-video and widen the box.
 */
export default function VideoBox({ videoRef, audioRef }: VideoBoxProps) {
  return (
    <div className="aspect-square w-[350px] max-w-full flex rounded-sm overflow-hidden items-center justify-center bg-simligray">
      {/* muted: the voice plays from the <audio> below, which is Simli's lip-synced audio */}
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
