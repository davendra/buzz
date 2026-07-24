import { Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import type { ConnectionState } from "@/features/agents/ui/agentSessionTypes";

type JarvisStatusBarProps = {
  agentName: string | null;
  agentStatus: string | null;
  observerState: ConnectionState;
  working: boolean;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
};

function Pill({
  label,
  value,
  tone = "cyan",
}: {
  label: string;
  value: string;
  tone?: "cyan" | "amber" | "dim";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs tracking-[0.25em] opacity-50">{label}</span>
      <span
        className={cn(
          "text-2xs font-semibold tracking-wider",
          tone === "amber" && "jarvis-amber",
          tone === "dim" && "opacity-60",
          tone === "cyan" && "jarvis-glow-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function JarvisStatusBar({
  agentName,
  agentStatus,
  observerState,
  working,
  voiceEnabled,
  onToggleVoice,
}: JarvisStatusBarProps) {
  const online = observerState === "open";
  return (
    <div className="jarvis-panel flex items-center justify-between gap-4 rounded-md px-4 py-2">
      <div className="flex items-center gap-4">
        <Pill label="AGENT" value={agentName ?? "—"} />
        <Pill
          label="STATE"
          value={working ? "WORKING" : (agentStatus ?? "idle").toUpperCase()}
          tone={working ? "amber" : "dim"}
        />
        <div className="flex items-center gap-1.5">
          {online ? (
            <Wifi className="size-3.5 opacity-80" />
          ) : (
            <WifiOff className="size-3.5 opacity-50" />
          )}
          <span className="text-2xs tracking-wider opacity-60">
            {online ? "LINK" : observerState.toUpperCase()}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleVoice}
        className="flex items-center gap-1.5 rounded-sm border border-[color:var(--jarvis-line)] px-2 py-1 text-2xs tracking-wider transition-opacity hover:opacity-80"
        aria-pressed={voiceEnabled}
      >
        {voiceEnabled ? (
          <Volume2 className="size-3.5" />
        ) : (
          <VolumeX className="size-3.5 opacity-50" />
        )}
        {voiceEnabled ? "VOICE ON" : "VOICE OFF"}
      </button>
    </div>
  );
}
