import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  ClipboardList,
  MessageSquare,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";

type LogLine = {
  id: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  tone: "cyan" | "amber" | "red" | "dim" | "answer";
};

function latency(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "";
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function toLogLine(item: TranscriptItem): LogLine | null {
  switch (item.type) {
    case "message":
      return {
        id: item.id,
        icon: MessageSquare,
        label: item.role === "user" ? "YOU" : "REPLY",
        detail: item.text,
        tone: item.role === "user" ? "amber" : "cyan",
      };
    case "thought":
      return {
        id: item.id,
        icon: Brain,
        label: "THINKING",
        detail: item.text,
        tone: "dim",
      };
    case "plan":
      return {
        id: item.id,
        icon: ClipboardList,
        label: "PLAN",
        detail: item.text,
        tone: "dim",
      };
    case "tool": {
      const verb = item.descriptor.action?.verb ?? item.descriptor.label;
      const object = item.descriptor.action?.object ?? "";
      const lat = latency(item.startedAt, item.completedAt);
      return {
        id: item.id,
        icon: item.renderClass === "shell" ? Terminal : Wrench,
        label: verb.toUpperCase(),
        detail: [object, lat && `· ${lat}`].filter(Boolean).join(" "),
        tone: item.isError ? "red" : "cyan",
      };
    }
    case "lifecycle":
      return {
        id: item.id,
        icon:
          item.renderClass === "error"
            ? AlertTriangle
            : item.renderClass === "permission"
              ? ShieldCheck
              : Activity,
        label: item.title.toUpperCase(),
        detail: item.outcome ?? item.text,
        tone: item.renderClass === "error" ? "red" : "dim",
      };
    default:
      return null;
  }
}

const TONE_CLASS: Record<LogLine["tone"], string> = {
  cyan: "text-[color:var(--jarvis-cyan)]",
  amber: "jarvis-amber",
  red: "text-red-400",
  dim: "text-[color:var(--jarvis-cyan)] opacity-60",
  // The answer is the payload of the whole turn — full brightness, and it wraps
  // instead of truncating so it can actually be read.
  answer: "jarvis-glow-text font-semibold",
};

export function JarvisActionLog({
  items,
  answer,
}: {
  items: TranscriptItem[];
  /** The agent's published channel reply — the actual answer, appended last so
   *  it's readable here and not just spoken. */
  answer?: { id: string; text: string } | null;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lines = React.useMemo(() => {
    const base = items.map(toLogLine).filter((l): l is LogLine => l !== null);
    if (answer) {
      base.push({
        id: `answer-${answer.id}`,
        icon: MessageSquare,
        label: "ANSWER",
        detail: answer.text,
        tone: "answer",
      });
    }
    return base;
  }, [items, answer]);

  // Auto-scroll to the newest line as activity streams in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to pin scroll whenever the line set changes, even though the body only touches the ref
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={scrollRef}
      className="jarvis-panel flex h-full flex-col gap-1.5 overflow-y-auto rounded-md p-3 font-mono"
    >
      <div className="jarvis-glow-text mb-1 text-2xs font-semibold tracking-[0.3em] opacity-70">
        ACTION LOG
      </div>
      {lines.length === 0 ? (
        <div className="text-xs opacity-40">— awaiting activity —</div>
      ) : (
        lines.map((line) => {
          const Icon = line.icon;
          return (
            <div key={line.id} className="flex items-start gap-2 text-xs">
              <Icon className="mt-0.5 size-3.5 shrink-0 opacity-80" />
              <span className="shrink-0 font-semibold tracking-wider opacity-80">
                {line.label}
              </span>
              <span
                className={cn(
                  "min-w-0",
                  // Tool/status lines stay one line so the log scans quickly;
                  // the answer wraps so it can be read in full.
                  line.tone === "answer" ? "whitespace-pre-wrap" : "truncate",
                  TONE_CLASS[line.tone],
                )}
              >
                {line.detail}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
