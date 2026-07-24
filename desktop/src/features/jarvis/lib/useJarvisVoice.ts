import * as React from "react";

/**
 * Speak the concierge's reply aloud. The native Pocket TTS command is
 * huddle-gated, so the standalone HUD uses the browser Web Speech API
 * (`speechSynthesis`) — the same fallback the reference JARVIS playbook
 * specifies. We speak once per message, only after the turn settles (so we
 * voice the finished reply, not half-streamed chunks). `speechSynthesis` owns a
 * native utterance queue, so playback is sequential and non-overlapping; the
 * kill switch cancels it outright.
 */
export function useJarvisVoice(params: {
  reply: { id: string; text: string } | null;
  isWorking: boolean;
  voiceEnabled: boolean;
  killedMessageId: string | null;
}) {
  const { reply, isWorking, voiceEnabled, killedMessageId } = params;
  const spokenIds = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!voiceEnabled || isWorking || !reply) return;
    if (reply.text.trim().length <= 1) return;
    if (spokenIds.current.has(reply.id)) return;
    // Kill switch: "*" suppresses everything; a specific id suppresses that one.
    if (killedMessageId === "*" || killedMessageId === reply.id) {
      spokenIds.current.add(reply.id);
      return;
    }
    spokenIds.current.add(reply.id);

    const synth = window.speechSynthesis;
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(reply.text);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    synth.speak(utterance);
  }, [reply, isWorking, voiceEnabled, killedMessageId]);
}

/** Immediately silence any in-flight or queued speech. */
export function stopJarvisSpeech() {
  window.speechSynthesis?.cancel();
}
