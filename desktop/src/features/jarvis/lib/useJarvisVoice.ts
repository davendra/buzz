import * as React from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Speak the concierge's reply aloud via the native Pocket TTS command
 * (`speak_agent_message`, the same one the huddle uses). We speak once per
 * message, only after the turn is no longer "working" (so we voice the settled
 * reply, not half-streamed chunks), and never when the kill switch has
 * suppressed the current message.
 *
 * All speech goes through the Rust backend, which owns sequential/non-overlapping
 * playback — we never play audio in JS.
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
    invoke("speak_agent_message", { text: reply.text }).catch(() => {
      // Backpressure or TTS pipeline unavailable (e.g. no active voice
      // session) — the HUD still shows the text; audio is best-effort.
    });
  }, [reply, isWorking, voiceEnabled, killedMessageId]);
}

/** Best-effort request to silence any in-flight speech. */
export function stopJarvisSpeech() {
  invoke("stop_agent_speech").catch(() => {
    // Command may not exist in this build; the kill switch still suppresses
    // future chunks at the JS layer. No-op on failure.
  });
}
