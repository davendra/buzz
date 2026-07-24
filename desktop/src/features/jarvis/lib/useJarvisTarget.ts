import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import type { ManagedAgent } from "@/shared/api/types";

/** Agents whose name looks like the JARVIS concierge, most-preferred first. */
const CONCIERGE_HINTS = ["jarvis", "concierge"];

function conciergeRank(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < CONCIERGE_HINTS.length; i++) {
    if (lower.includes(CONCIERGE_HINTS[i])) return i;
  }
  return Number.POSITIVE_INFINITY;
}

export type JarvisTarget = {
  /** The agent the HUD is currently driving, or null when none exists. */
  target: ManagedAgent | null;
  /** All managed agents, for the target picker. */
  agents: ManagedAgent[];
  isLoading: boolean;
};

/**
 * Resolve which agent the HUD speaks to. Preference order:
 *   1. explicit user override (if it still exists),
 *   2. an agent named like the concierge ("jarvis"/"concierge"),
 *   3. the first running agent,
 *   4. the first agent.
 */
export function useJarvisTarget(overridePubkey: string | null): JarvisTarget {
  const query = useManagedAgentsQuery();
  const agents = React.useMemo(() => query.data ?? [], [query.data]);

  const target = React.useMemo<ManagedAgent | null>(() => {
    if (agents.length === 0) return null;

    if (overridePubkey) {
      const chosen = agents.find((a) => a.pubkey === overridePubkey);
      if (chosen) return chosen;
    }

    const byConcierge = [...agents].sort(
      (a, b) => conciergeRank(a.name) - conciergeRank(b.name),
    );
    if (conciergeRank(byConcierge[0].name) !== Number.POSITIVE_INFINITY) {
      return byConcierge[0];
    }

    const running = agents.find((a) => a.status === "running");
    return running ?? agents[0];
  }, [agents, overridePubkey]);

  return { target, agents, isLoading: query.isLoading };
}
