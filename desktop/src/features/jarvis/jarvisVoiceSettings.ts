import * as React from "react";

/**
 * Which engine speaks the agent's answers.
 *
 * - `off`      — silent; text only.
 * - `pocket`   — bundled Pocket TTS (sherpa-onnx). Local, free, private: the
 *                text never leaves the machine. Default.
 * - `google`   — Google Cloud Chirp 3: HD. Best quality; free tier covers
 *                ~1M chars/month. Sends the answer text to Google.
 * - `browser`  — Web Speech API. Always available, robotic; the last-resort
 *                fallback when nothing else can speak.
 */
export type TtsProvider = "off" | "pocket" | "google" | "browser";

export type JarvisVoiceSettings = {
  provider: TtsProvider;
  /** Google voice name, e.g. "en-GB-Chirp3-HD-Achernar". */
  googleVoice: string;
};

const STORAGE_KEY = "buzz.jarvis.voice";

export const DEFAULT_GOOGLE_VOICE = "en-GB-Chirp3-HD-Achernar";

const DEFAULTS: JarvisVoiceSettings = {
  // Local and private by default — a cloud voice is an explicit opt-in, since
  // these agents speak client names and financial figures.
  provider: "pocket",
  googleVoice: DEFAULT_GOOGLE_VOICE,
};

function load(): JarvisVoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<JarvisVoiceSettings>;
    return {
      provider: parsed.provider ?? DEFAULTS.provider,
      googleVoice: parsed.googleVoice ?? DEFAULTS.googleVoice,
    };
  } catch {
    return DEFAULTS;
  }
}

let settings: JarvisVoiceSettings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode / quota) — settings stay in memory for
    // this session rather than failing the caller.
  }
}

export function getJarvisVoiceSettings(): JarvisVoiceSettings {
  return settings;
}

export function subscribeJarvisVoiceSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTtsProvider(provider: TtsProvider) {
  if (settings.provider === provider) return;
  settings = { ...settings, provider };
  persist();
  emit();
}

export function setGoogleVoice(googleVoice: string) {
  if (settings.googleVoice === googleVoice) return;
  settings = { ...settings, googleVoice };
  persist();
  emit();
}

export function useJarvisVoiceSettings(): JarvisVoiceSettings {
  return React.useSyncExternalStore(
    subscribeJarvisVoiceSettings,
    getJarvisVoiceSettings,
  );
}

/** Reset to defaults — used when switching communities. */
export function resetJarvisVoiceSettings() {
  settings = load();
  emit();
}
