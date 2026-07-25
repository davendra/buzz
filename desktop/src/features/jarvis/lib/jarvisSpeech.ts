import { invoke } from "@tauri-apps/api/core";

import type { TtsProvider } from "../jarvisVoiceSettings";

/**
 * Speech output for the HUD, across providers.
 *
 * Design notes:
 * - **Sentence chunking.** Long answers are split so the first sentence starts
 *   playing while the rest is still synthesising — the difference between
 *   ~400ms and several seconds before you hear anything.
 * - **Strictly sequential.** One utterance at a time, in order. Pocket TTS
 *   enforces this natively (single player); for cloud audio we await each clip.
 * - **Cancellable.** `stopSpeaking()` silences immediately and drops anything
 *   queued, including in-flight synthesis.
 * - **Fallback chain.** A cloud provider that fails (offline, quota, bad key)
 *   falls back to Pocket TTS, then the browser — so a network blip degrades the
 *   voice instead of silently killing it.
 */

/** Bumped on every stop; in-flight work compares against it and bails. */
let generation = 0;
let current: HTMLAudioElement | null = null;

/** Split into speakable chunks, keeping sentences intact where possible. */
export function chunkForSpeech(text: string, maxChars = 240): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Split after sentence-ending punctuation followed by whitespace.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence;
    } else if (`${buffer} ${sentence}`.length <= maxChars) {
      buffer = `${buffer} ${sentence}`;
    } else {
      chunks.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/** Silence everything now and invalidate queued/in-flight speech. */
export function stopSpeaking() {
  generation += 1;
  if (current) {
    current.pause();
    current.src = "";
    current = null;
  }
  window.speechSynthesis?.cancel();
  // Pocket TTS runs in Rust; ask it to barge-in.
  invoke("jarvis_stop_speaking").catch(() => {
    /* command unavailable in this build — JS-side cancel already applied */
  });
}

function speakBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

function playBase64Mp3(base64: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== generation) {
      resolve();
      return;
    }
    const audio = new Audio(`data:audio/mp3;base64,${base64}`);
    current = audio;
    const done = () => {
      if (current === audio) current = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  });
}

/**
 * Speak `text` with `provider`, chunked and in order.
 *
 * Resolves when finished, cancelled, or after falling back. Never rejects — a
 * failure to speak must not break the turn.
 */
export async function speak(
  text: string,
  provider: TtsProvider,
  googleVoice: string,
): Promise<void> {
  if (provider === "off") return;
  const chunks = chunkForSpeech(text);
  if (chunks.length === 0) return;

  generation += 1;
  const mine = generation;

  // Pocket TTS does its own sentence pipelining in Rust, so hand it the whole
  // text and let it stream — chunking here would only add gaps.
  if (provider === "pocket") {
    try {
      await invoke("jarvis_speak", { text });
      return;
    } catch (e) {
      console.warn("[jarvis-tts] pocket failed, falling back to browser:", e);
      if (mine !== generation) return;
      for (const chunk of chunks) {
        if (mine !== generation) return;
        await speakBrowser(chunk);
      }
      return;
    }
  }

  if (provider === "google") {
    for (const chunk of chunks) {
      if (mine !== generation) return;
      try {
        const audio = await invoke<string>("jarvis_google_tts", {
          text: chunk,
          voice: googleVoice,
        });
        if (mine !== generation) return;
        await playBase64Mp3(audio, mine);
      } catch (e) {
        console.warn("[jarvis-tts] google failed, falling back to pocket:", e);
        if (mine !== generation) return;
        try {
          await invoke("jarvis_speak", { text });
        } catch {
          for (const rest of chunks) {
            if (mine !== generation) return;
            await speakBrowser(rest);
          }
        }
        return;
      }
    }
    return;
  }

  for (const chunk of chunks) {
    if (mine !== generation) return;
    await speakBrowser(chunk);
  }
}
