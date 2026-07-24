import * as React from "react";
import { Mic, Send, Square } from "lucide-react";

import { cn } from "@/shared/lib/cn";

/** Quick-intent buttons. Clicking prefixes the input with the phrase. */
const SLASH_COMMANDS: { label: string; phrase: string }[] = [
  { label: "/pipeline", phrase: "what does my mortgage pipeline look like" },
  { label: "/receivables", phrase: "what are our total receivables" },
  { label: "/stock", phrase: "how many products are out of stock" },
  { label: "/sales", phrase: "what were our sales this month" },
  { label: "/cpd", phrase: "what is my CPD standing this year" },
  { label: "/customers", phrase: "who are our top customers" },
];

type JarvisControlsProps = {
  onSend: (text: string) => void;
  onKillVoice: () => void;
  disabled: boolean;
  disabledReason: string | null;
  /** Push-to-talk: hold to record, release to transcribe + send. */
  voice: {
    holding: boolean;
    error: string | null;
    press: () => void;
    release: () => void;
  };
};

export function JarvisControls({
  onSend,
  onKillVoice,
  disabled,
  disabledReason,
  voice,
}: JarvisControlsProps) {
  const [value, setValue] = React.useState("");

  const submit = React.useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }, [value, disabled, onSend]);

  return (
    <div className="flex flex-col gap-2">
      {voice.error ? (
        <div className="text-2xs tracking-wider text-red-400">
          MIC: {voice.error}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {SLASH_COMMANDS.map((cmd) => (
          <button
            key={cmd.label}
            type="button"
            onClick={() => setValue(cmd.phrase)}
            className="rounded-sm border border-[color:var(--jarvis-line)] px-2 py-1 text-2xs tracking-wider transition-opacity hover:opacity-80"
          >
            {cmd.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            voice.press();
          }}
          onPointerUp={voice.release}
          onPointerLeave={() => voice.holding && voice.release()}
          aria-label="Hold to talk"
          title={voice.error ?? "Hold to talk"}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full border transition-all",
            voice.holding
              ? "jarvis-amber scale-110 border-[color:var(--jarvis-amber)] shadow-[0_0_16px_rgba(255,182,72,0.6)]"
              : "border-[color:var(--jarvis-line)] jarvis-glow-text",
          )}
        >
          <Mic className="size-4" />
        </button>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabledReason ?? "Speak or type a request…"}
          disabled={disabled}
          className={cn(
            "jarvis-panel min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none placeholder:opacity-40",
            "focus:border-[color:var(--jarvis-cyan)]",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="jarvis-panel flex items-center gap-1.5 rounded-md px-3 py-2 text-xs tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          <Send className="size-3.5" />
          SEND
        </button>
        <button
          type="button"
          onClick={onKillVoice}
          className="flex items-center gap-1.5 rounded-md border border-red-500/50 px-3 py-2 text-xs tracking-wider text-red-400 transition-opacity hover:opacity-80"
          title="Stop voice immediately; text keeps streaming"
        >
          <Square className="size-3.5 fill-current" />
          KILL VOICE
        </button>
      </div>
    </div>
  );
}
