import * as React from "react";

import { cn } from "@/shared/lib/cn";

type JarvisReactorProps = {
  /** True while the agent has an active turn — pulses faster. */
  active: boolean;
  /** Short status word rendered under the core (e.g. "LISTENING"). */
  statusLabel: string;
};

/**
 * The central arc-reactor + radar. Purely decorative; all motion is CSS-driven
 * (see jarvis.css) and disabled under prefers-reduced-motion.
 */
export const JarvisReactor = React.memo(function JarvisReactor({
  active,
  statusLabel,
}: JarvisReactorProps) {
  return (
    <div className="relative flex h-64 w-64 items-center justify-center">
      {/* Outer rotating rings */}
      <div className="jarvis-reactor-ring jarvis-spin-slow absolute inset-0" />
      <div className="jarvis-reactor-ring jarvis-spin-rev absolute inset-6 opacity-70" />
      <div className="jarvis-reactor-ring absolute inset-12 opacity-50" />

      {/* Radar sweep */}
      <div className="jarvis-radar-sweep absolute inset-10 opacity-60" />

      {/* Tick marks */}
      <div className="jarvis-spin-slow absolute inset-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative ring, index is stable
            key={i}
            className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-[color:var(--jarvis-cyan)] opacity-40"
            style={{
              transformOrigin: "50% 128px",
              transform: `rotate(${i * 15}deg)`,
            }}
          />
        ))}
      </div>

      {/* Core */}
      <div className="jarvis-reactor-core h-24 w-24" data-active={active} />

      {/* Status label */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            "jarvis-glow-text mt-32 text-2xs font-semibold tracking-[0.35em]",
            active ? "jarvis-amber" : "opacity-80",
          )}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
});
