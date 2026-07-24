import * as React from "react";

/**
 * Module-level store for the JARVIS voice-HUD overlay. Kept outside the React
 * tree (like the huddle/observer stores) so the HUD can be toggled from a global
 * hotkey and read from any surface without prop-drilling. A community switch
 * resets it via `resetJarvisHudState` wired into `resetCommunityState`.
 */

type JarvisHudState = {
  /** Whether the full-screen HUD overlay is visible. */
  open: boolean;
  /** User-chosen target agent pubkey; null means "auto-pick the concierge". */
  targetOverride: string | null;
  /** Speak agent replies aloud via native Pocket TTS. */
  voiceEnabled: boolean;
  /**
   * When the user hits "Kill Voice", we record the id of the message that was
   * speaking so the voice effect suppresses that message (and anything already
   * queued) without muting the whole session. Cleared on the next user turn.
   */
  killedMessageId: string | null;
};

let state: JarvisHudState = {
  open: false,
  targetOverride: null,
  voiceEnabled: true,
  killedMessageId: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<JarvisHudState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeJarvisHud(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getJarvisHudState(): JarvisHudState {
  return state;
}

export function openJarvis() {
  if (!state.open) setState({ open: true });
}

export function closeJarvis() {
  if (state.open) setState({ open: false });
}

export function toggleJarvis() {
  setState({ open: !state.open });
}

export function setJarvisTarget(pubkey: string | null) {
  setState({ targetOverride: pubkey });
}

export function setJarvisVoiceEnabled(enabled: boolean) {
  setState({ voiceEnabled: enabled });
}

/** Suppress voice for the currently-speaking message and anything queued. */
export function killJarvisVoice(messageId: string | null) {
  setState({ killedMessageId: messageId ?? state.killedMessageId ?? "*" });
}

/** Clear the kill flag (called when a new user turn starts). */
export function clearJarvisVoiceKill() {
  if (state.killedMessageId !== null) setState({ killedMessageId: null });
}

export function resetJarvisHudState() {
  state = {
    open: false,
    targetOverride: null,
    voiceEnabled: true,
    killedMessageId: null,
  };
  emit();
}

// ── React hooks ────────────────────────────────────────────────────────────

export function useJarvisHudState(): JarvisHudState {
  return React.useSyncExternalStore(subscribeJarvisHud, getJarvisHudState);
}
