// Small browser-side audio helpers for the ElevenLabs <-> Simli bridge.

export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** "pcm_16000" -> 16000; anything that isn't raw PCM (e.g. "ulaw_8000") -> null. */
export function pcmRate(format: string | undefined): number | null {
  const m = /^pcm_(\d+)$/.exec(format ?? "");
  return m ? Number(m[1]) : null;
}

// AudioWorklet: mic Float32 frames -> PCM16 at `targetRate`, posted in ~100 ms chunks.
// If the AudioContext already runs at targetRate this is a plain conversion; otherwise it
// resamples linearly (fallback for browsers that refuse a 16 kHz context with a mic source).
const MIC_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions.targetRate;
    this.step = sampleRate / this.target;
    this.pos = 0;
    this.prev = 0;
    this.buf = new Int16Array(Math.round(this.target / 10));
    this.n = 0;
  }
  push(s) {
    s = Math.max(-1, Math.min(1, s));
    this.buf[this.n++] = Math.round(s * 32767);
    if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.step === 1) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i]);
      return true;
    }
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i === 0 ? this.prev : ch[i - 1];
      const b = ch[i];
      this.push(a + (b - a) * f);
      this.pos += this.step;
    }
    this.pos -= ch.length;
    this.prev = ch[ch.length - 1];
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export type MicCapture = { stop: () => void };

/**
 * Opens the microphone and calls `onChunk` with PCM16 mono at `targetRate` (~100 ms per chunk).
 * echoCancellation is on so the avatar's voice from the speakers isn't sent back to the agent.
 */
export async function startMicCapture(targetRate: number, onChunk: (pcm: Int16Array) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let ctx: AudioContext | null = null;
  try {
    let source: MediaStreamAudioSourceNode;
    try {
      ctx = new AudioContext({ sampleRate: targetRate });
      source = ctx.createMediaStreamSource(stream);
    } catch {
      // Some browsers can't connect a mic to a context at a different rate: resample in the worklet.
      void ctx?.close();
      ctx = new AudioContext();
      source = ctx.createMediaStreamSource(stream);
    }
    const url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // numberOfOutputs: 0 makes it a sink: it is processed without being routed to the speakers.
    const node = new AudioWorkletNode(ctx, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions: { targetRate },
    });
    node.port.onmessage = (e: MessageEvent<Int16Array>) => onChunk(e.data);
    source.connect(node);
    if (ctx.state === "suspended") await ctx.resume();

    const audioCtx = ctx;
    return {
      stop: () => {
        node.port.onmessage = null;
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void audioCtx.close();
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close();
    throw err;
  }
}
