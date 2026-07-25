import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Volume2 } from "lucide-react";

import {
  DEFAULT_GOOGLE_VOICE,
  setGoogleVoice,
  setTtsProvider,
  useJarvisVoiceSettings,
  type TtsProvider,
} from "../jarvisVoiceSettings";
import { speak, stopSpeaking } from "../lib/jarvisSpeech";

type ProviderStatus = { pocket_ready: boolean; google_configured: boolean };

const PROVIDERS: Array<{
  value: TtsProvider;
  label: string;
  description: string;
}> = [
  {
    value: "pocket",
    label: "Built-in voice (recommended)",
    description:
      "Runs on this Mac. Free, works offline, and nothing you ask or hear is sent anywhere.",
  },
  {
    value: "google",
    label: "Google Chirp 3: HD",
    description:
      "Google's most natural voice. Free for roughly a million characters a month. Requires a service-account key — see below.",
  },
  {
    value: "browser",
    label: "System voice",
    description:
      "Always available and instant, but noticeably robotic. Useful as a fallback.",
  },
  { value: "off", label: "Off", description: "Show answers as text only." },
];

const SAMPLE =
  "Receivables are about one lakh fifty-two thousand rupees, with thirty-seven invoices overdue.";

export function JarvisVoiceSettingsCard() {
  const { provider, googleVoice } = useJarvisVoiceSettings();
  const [status, setStatus] = React.useState<ProviderStatus | null>(null);
  const [voices, setVoices] = React.useState<string[]>([]);
  const [voicesError, setVoicesError] = React.useState<string | null>(null);

  React.useEffect(() => {
    invoke<ProviderStatus>("jarvis_tts_status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Only ask Google for its voice list when that provider is actually selected
  // and configured — otherwise it's a guaranteed error.
  React.useEffect(() => {
    if (provider !== "google" || !status?.google_configured) return;
    let cancelled = false;
    invoke<string[]>("jarvis_google_voices")
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        setVoicesError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setVoicesError(typeof e === "string" ? e : "Could not list voices");
      });
    return () => {
      cancelled = true;
    };
  }, [provider, status?.google_configured]);

  const googleUnavailable = provider === "google" && !status?.google_configured;

  return (
    <section
      data-testid="settings-jarvis-voice"
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-2">
        <Volume2 className="size-4 text-muted-foreground" />
        <h3 className="font-medium text-base">JARVIS voice</h3>
      </div>
      <p className="text-muted-foreground text-sm">
        How spoken answers are read aloud in the JARVIS heads-up display (⌘J).
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Voice provider</legend>
        {PROVIDERS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-accent/40"
          >
            <input
              type="radio"
              name="jarvis-tts-provider"
              className="mt-1"
              checked={provider === option.value}
              onChange={() => setTtsProvider(option.value)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">{option.label}</span>
              <span className="text-muted-foreground text-xs">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {provider === "google" ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="font-medium text-sm" htmlFor="jarvis-google-voice">
            Google voice
          </label>
          {voices.length > 0 ? (
            <select
              id="jarvis-google-voice"
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={googleVoice}
              onChange={(e) => setGoogleVoice(e.target.value)}
            >
              {voices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="jarvis-google-voice"
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={googleVoice}
              placeholder={DEFAULT_GOOGLE_VOICE}
              onChange={(e) => setGoogleVoice(e.target.value)}
            />
          )}
          {voicesError ? (
            <p className="text-destructive text-xs">{voicesError}</p>
          ) : null}
        </div>
      ) : null}

      {googleUnavailable ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">Google voice needs a key</p>
          <p className="mt-1 text-muted-foreground">
            Cloud Text-to-Speech doesn't accept API keys. In Google Cloud:
            enable the Text-to-Speech API, create a{" "}
            <strong>service account</strong>, add a <strong>JSON key</strong>,
            then save the downloaded file as{" "}
            <code>~/.buzz/jarvis-tts-google.json</code> and restart Buzz. It is
            read by the app itself and never sent to the browser layer.
          </p>
        </div>
      ) : null}

      {provider === "google" ? (
        <div className="rounded-md border border-border p-3 text-muted-foreground text-xs">
          <span className="font-medium text-foreground">Privacy: </span>
          answers are sent to Google to be spoken. Your agents read out client
          names and financial figures, so if that data is regulated, prefer the
          built-in voice, which never leaves this Mac.
        </div>
      ) : null}

      {status && !status.pocket_ready && provider === "pocket" ? (
        <p className="text-muted-foreground text-xs">
          The built-in voice model hasn't finished downloading yet — the system
          voice is used until it has.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => void speak(SAMPLE, provider, googleVoice)}
          disabled={provider === "off"}
        >
          Test voice
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={stopSpeaking}
        >
          Stop
        </button>
      </div>
    </section>
  );
}
