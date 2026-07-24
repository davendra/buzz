import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Push-to-talk voice input for the HUD. Captures the mic, streams f32/48kHz PCM
 * to the decoupled JARVIS STT session in Rust (`jarvis_push_audio`), gates it
 * with a hold-to-talk flag (`jarvis_set_ptt`), and surfaces each finalized
 * utterance via the `jarvis-transcript` Tauri event. No huddle involved.
 */

// Raw binary invoke (zero-copy) — mirrors the huddle audioWorklet helper.
function invokeRawBinary(cmd: string, payload: Uint8Array): Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: Tauri internals have no public type
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    return Promise.reject(new Error("Tauri internals not available"));
  }
  return internals.invoke(cmd, payload);
}

type MicHandle = {
  stop: () => void;
  setTransmitting: (active: boolean) => void;
};

async function startMic(): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const track = stream.getAudioTracks()[0];
  const ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.audioWorklet.addModule("/worklet.js");
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ctx, "stt-tap-processor");
  source.connect(node);
  // Start muted — audio only flows while the button is held.
  node.port.postMessage({ type: "ptt", active: false });
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const f32 = event.data;
    invokeRawBinary(
      "jarvis_push_audio",
      new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength),
    ).catch(() => {
      /* backpressure — Rust drops silently */
    });
  };
  return {
    stop: () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      track.stop();
      void ctx.close();
    },
    setTransmitting: (active: boolean) => {
      node.port.postMessage({ type: "ptt", active });
    },
  };
}

export function useJarvisPushToTalk(params: {
  enabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const { enabled, onTranscript } = params;
  const [holding, setHolding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const micRef = React.useRef<MicHandle | null>(null);
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Start/stop the Rust STT session with the HUD, and relay transcripts.
  React.useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void invoke("jarvis_start_listening").catch((e) => {
      if (!disposed) setError(typeof e === "string" ? e : "voice unavailable");
    });
    void listen<string>("jarvis-transcript", (event) => {
      const text = event.payload?.trim();
      if (text) onTranscriptRef.current(text);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
      micRef.current?.stop();
      micRef.current = null;
      void invoke("jarvis_stop_listening").catch(() => {});
    };
  }, [enabled]);

  const press = React.useCallback(async () => {
    if (!enabled || holding) return;
    setError(null);
    try {
      if (!micRef.current) micRef.current = await startMic();
      micRef.current.setTransmitting(true);
      await invoke("jarvis_set_ptt", { active: true });
      setHolding(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "microphone unavailable");
    }
  }, [enabled, holding]);

  const release = React.useCallback(async () => {
    if (!holding) return;
    setHolding(false);
    micRef.current?.setTransmitting(false);
    await invoke("jarvis_set_ptt", { active: false }).catch(() => {});
  }, [holding]);

  return { holding, error, press, release };
}
