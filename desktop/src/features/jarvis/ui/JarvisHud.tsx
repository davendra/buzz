import * as React from "react";
import { Bot, X } from "lucide-react";

import { sendChannelMessage } from "@/shared/api/tauri";
import { useChannelsQuery } from "@/features/channels/hooks";
import { attachManagedAgentToChannel } from "@/features/agents/channelAgents";
import { useManagedAgentObserverBridge } from "@/features/agents/observerRelayStore";
import {
  useAgentTranscript,
  useObserverEvents,
} from "@/features/agents/ui/useObserverEvents";
import {
  useActiveAgentTurns,
  useActiveAgentTurnsBridge,
} from "@/features/agents/activeAgentTurnsStore";
import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";

import "./jarvis.css";
import {
  clearJarvisVoiceKill,
  closeJarvis,
  killJarvisVoice,
  setJarvisTarget,
  setJarvisVoiceEnabled,
  toggleJarvis,
  useJarvisHudState,
} from "../jarvisHudStore";
import { useEnsureSeedAgents } from "../lib/useEnsureSeedAgents";
import { useJarvisTarget } from "../lib/useJarvisTarget";
import { useJarvisPushToTalk } from "../lib/useJarvisPushToTalk";
import { stopJarvisSpeech, useJarvisVoice } from "../lib/useJarvisVoice";
import { JarvisActionLog } from "./JarvisActionLog";
import { JarvisControls } from "./JarvisControls";
import { JarvisReactor } from "./JarvisReactor";
import { JarvisResponse } from "./JarvisResponse";
import { JarvisStatusBar } from "./JarvisStatusBar";

/** The newest assistant message in the transcript = the current reply. */
function latestAssistantMessage(
  items: TranscriptItem[],
): { id: string; text: string; channelId: string | null } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "message" && item.role === "assistant") {
      return {
        id: item.id,
        text: item.text,
        channelId: item.channelId ?? null,
      };
    }
  }
  return null;
}

/** The channel the agent is currently active in, for routing a typed reply. */
function activeChannelId(items: TranscriptItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const channelId = items[i].channelId;
    if (channelId) return channelId;
  }
  return null;
}

export function JarvisHud() {
  // Auto-create the user's saved agents on startup so they persist across
  // launches (independent of whether the HUD is opened).
  useEnsureSeedAgents();

  const { open, targetOverride, voiceEnabled, killedMessageId } =
    useJarvisHudState();
  const { target, agents } = useJarvisTarget(targetOverride);
  const targetPubkey = target?.pubkey ?? null;

  // Global toggle hotkey: Cmd/Ctrl+J.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleJarvis();
      }
      if (e.key === "Escape" && open) closeJarvis();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Only observe/subscribe while the HUD is open and pointed at an agent.
  const observedAgents = React.useMemo(
    () =>
      open && target ? [{ pubkey: target.pubkey, status: target.status }] : [],
    [open, target],
  );
  useManagedAgentObserverBridge(observedAgents);
  // Derive live "working" turns from the same observer stream so the reactor
  // pulses while the concierge is mid-turn.
  useActiveAgentTurnsBridge(observedAgents);

  const enabled = open && !!targetPubkey;
  const transcript = useAgentTranscript(enabled, targetPubkey);
  const observer = useObserverEvents(enabled, targetPubkey);
  const activeTurns = useActiveAgentTurns(targetPubkey);
  const working = activeTurns.length > 0;

  const reply = React.useMemo(
    () => latestAssistantMessage(transcript),
    [transcript],
  );

  useJarvisVoice({
    reply: reply ? { id: reply.id, text: reply.text } : null,
    isWorking: working,
    voiceEnabled,
    killedMessageId,
  });

  // Where to send. Prefer the channel the agent is already active in; otherwise
  // fall back to a real channel so a brand-new agent (empty transcript) doesn't
  // leave the HUD's input, send button and mic all disabled with no way to
  // bootstrap. Prefers "general", else the first non-DM channel.
  const channelsQuery = useChannelsQuery();
  const fallbackChannelId = React.useMemo(() => {
    const channels = (channelsQuery.data ?? []).filter(
      (c) => c.channelType !== "dm",
    );
    if (channels.length === 0) return null;
    const general = channels.find((c) => c.name.toLowerCase() === "general");
    return (general ?? channels[0]).id;
  }, [channelsQuery.data]);

  const channelId = React.useMemo(
    () => reply?.channelId ?? activeChannelId(transcript) ?? fallbackChannelId,
    [reply, transcript, fallbackChannelId],
  );

  const handleSend = React.useCallback(
    (text: string) => {
      console.warn(
        `[jarvis] send: target=${targetPubkey?.slice(0, 8)} channel=${channelId} text="${text}"`,
      );
      if (!targetPubkey || !channelId) {
        console.warn("[jarvis] send BLOCKED — missing target or channel");
        return;
      }
      clearJarvisVoiceKill();
      // An agent only receives mentions in channels it belongs to. A freshly
      // seeded agent is in none, so attach it first (idempotent — already-member
      // is not an error) and only then send, otherwise the message posts fine
      // but the agent never sees it and the HUD sits on "awaiting activity".
      void (async () => {
        if (target) {
          try {
            await attachManagedAgentToChannel(channelId, { agent: target });
            console.warn("[jarvis] agent attached to channel");
          } catch (e) {
            console.warn("[jarvis] attach skipped:", e);
          }
        }
        try {
          await sendChannelMessage(channelId, text, null, undefined, [
            targetPubkey,
          ]);
          console.warn("[jarvis] send OK");
        } catch (err) {
          console.warn("[jarvis] send failed:", err);
        }
      })();
    },
    [targetPubkey, channelId, target],
  );

  const handleKillVoice = React.useCallback(() => {
    killJarvisVoice(reply?.id ?? "*");
    stopJarvisSpeech();
  }, [reply]);

  // Push-to-talk: hold the mic, release to transcribe and send to the concierge.
  const ptt = useJarvisPushToTalk({
    enabled: open && !!targetPubkey,
    onTranscript: handleSend,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggleJarvis}
        aria-label="Open JARVIS"
        title="Open JARVIS (⌘J)"
        data-testid="jarvis-launcher"
        className="jarvis-hud jarvis-panel fixed bottom-16 right-4 z-40 flex size-11 items-center justify-center rounded-full"
      >
        <Bot className="size-5 jarvis-glow-text" />
      </button>
    );
  }

  const disabledReason = !targetPubkey
    ? "No agent yet — create a “Jarvis” agent"
    : !channelId
      ? "Talk to Jarvis in a channel or huddle first"
      : null;

  return (
    <div
      data-testid="jarvis-hud"
      className="jarvis-hud jarvis-scanlines fixed inset-0 z-50 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="jarvis-glow-text text-lg font-semibold tracking-[0.4em]">
            J.A.R.V.I.S
          </span>
          {agents.length > 1 ? (
            <select
              value={targetPubkey ?? ""}
              onChange={(e) => setJarvisTarget(e.target.value || null)}
              className="jarvis-panel rounded-sm px-2 py-1 text-2xs tracking-wider outline-none"
            >
              {agents.map((a) => (
                <option key={a.pubkey} value={a.pubkey}>
                  {a.name} · {a.status} · {a.pubkey.slice(0, 6)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <button
          type="button"
          onClick={closeJarvis}
          aria-label="Close JARVIS"
          className="jarvis-panel flex size-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-6 pb-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex min-h-0 flex-col items-center justify-center gap-6">
          <JarvisReactor
            active={working}
            statusLabel={
              working ? "WORKING" : targetPubkey ? "STANDING BY" : "OFFLINE"
            }
          />
          <div className="w-full">
            <JarvisResponse text={reply?.text ?? null} working={working} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <JarvisActionLog items={transcript} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-3 px-6 pb-6">
        <JarvisStatusBar
          agentName={target?.name ?? null}
          agentStatus={target?.status ?? null}
          observerState={observer.connectionState}
          working={working}
          voiceEnabled={voiceEnabled}
          onToggleVoice={() => setJarvisVoiceEnabled(!voiceEnabled)}
        />
        <JarvisControls
          onSend={handleSend}
          onKillVoice={handleKillVoice}
          disabled={!!disabledReason}
          disabledReason={disabledReason}
          voice={ptt}
        />
      </div>
    </div>
  );
}
