import * as React from "react";

import { useJarvisVoiceSettings } from "../jarvisVoiceSettings";
import { speak, stopSpeaking } from "./jarvisSpeech";

/**
 * Speak the agent's published answer using the configured provider (Pocket TTS
 * by default, optionally Google Chirp 3: HD, browser, or off).
 *
 * Speaks once per message and only once the turn has settled, so we voice the
 * finished answer rather than partial streaming text.
 */
export function useJarvisVoice(params: {
  reply: { id: string; text: string } | null;
  isWorking: boolean;
  voiceEnabled: boolean;
  killedMessageId: string | null;
}) {
  const { reply, isWorking, voiceEnabled, killedMessageId } = params;
  const { provider, googleVoice } = useJarvisVoiceSettings();
  const spokenIds = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!voiceEnabled || provider === "off" || isWorking || !reply) return;
    if (reply.text.trim().length <= 1) return;
    if (spokenIds.current.has(reply.id)) return;
    // Kill switch: "*" suppresses everything; a specific id suppresses that one.
    if (killedMessageId === "*" || killedMessageId === reply.id) {
      spokenIds.current.add(reply.id);
      return;
    }
    spokenIds.current.add(reply.id);
    void speak(reply.text, provider, googleVoice);
  }, [reply, isWorking, voiceEnabled, killedMessageId, provider, googleVoice]);
}

/** Immediately silence any in-flight or queued speech. */
export function stopJarvisSpeech() {
  stopSpeaking();
}
