import * as React from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  useAcpRuntimesQuery,
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

type SeedAgent = { name: string; systemPrompt: string };

/**
 * Pick the runtime for seeded agents. We prefer **codex** (the OpenAI/ChatGPT
 * subscription runtime — auth via `codex login`, no API key), then the user's
 * configured preferred runtime, then buzz-agent, then anything available.
 */
function pickRuntime(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  preferredId: string | null,
): AcpRuntimeCatalogEntry | null {
  // Prefer codex (OpenAI/ChatGPT subscription — no API key) whenever it exists
  // with a resolved command, IGNORING the async `availability` stamp: codex's
  // adapter version-gate can still read "checking" when we seed, which would
  // otherwise drop us onto buzz-agent (which then demands an API key).
  const codex = runtimes.find((r) => r.id === "codex" && r.command);
  if (codex) return codex;
  const available = runtimes.filter((r) => r.availability === "available");
  return (
    (preferredId ? available.find((r) => r.id === preferredId) : undefined) ??
    available.find((r) => r.id === "buzz-agent") ??
    available[0] ??
    null
  );
}

/**
 * Auto-create the user's saved agents on startup so they don't have to re-enter
 * them every launch. Reads `~/.buzz/jarvis-seed-agents.json` via the
 * `read_jarvis_seed_agents` command and creates any that aren't already present
 * (matched by name), on the **codex** runtime (subscription auth — no API key,
 * no model to configure; codex uses `~/.codex/config.toml`). Runs once per
 * mount; a no-op when the seed file is absent.
 */
export function useEnsureSeedAgents() {
  const identity = useIdentityQuery();
  const agentsQuery = useManagedAgentsQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const { globalConfig } = useGlobalAgentConfig();
  const createMutation = useCreateManagedAgentMutation();
  const doneRef = React.useRef(false);

  const ready =
    !!identity.data?.pubkey &&
    !agentsQuery.isLoading &&
    !!agentsQuery.data &&
    !!runtimesQuery.data;

  const createAgent = createMutation.mutateAsync;

  // biome-ignore lint/correctness/useExhaustiveDependencies: run exactly once when ready; captured values are read at run time, guarded by doneRef
  React.useEffect(() => {
    if (!ready || doneRef.current) return;
    doneRef.current = true;

    const runtime = pickRuntime(
      runtimesQuery.data ?? [],
      globalConfig.preferred_runtime,
    );
    if (!runtime) {
      console.warn("[jarvis] no available agent runtime — skipping seed");
      return;
    }
    // console.warn is forwarded to the dev terminal (console.info is not),
    // so this makes the chosen runtime visible while debugging.
    console.warn(`[jarvis] seeding agents on runtime: ${runtime.id}`);

    void (async () => {
      let seeds: SeedAgent[] = [];
      try {
        seeds = await invoke<SeedAgent[]>("read_jarvis_seed_agents");
      } catch (e) {
        console.warn("[jarvis] reading seed agents failed:", e);
        return;
      }
      if (seeds.length === 0) return;

      const existing = new Set(
        (agentsQuery.data ?? []).map((a) => a.name.trim().toLowerCase()),
      );
      for (const seed of seeds) {
        if (existing.has(seed.name.trim().toLowerCase())) continue;
        try {
          await createAgent({
            name: seed.name,
            systemPrompt: seed.systemPrompt,
            acpCommand: "buzz-acp",
            agentCommand: runtime.command ?? undefined,
            agentArgs: runtime.defaultArgs,
            mcpCommand: runtime.mcpCommand ?? "",
            harnessOverride: true,
            spawnAfterCreate: true,
            startOnAppLaunch: true,
            // Local runtime = no remote provider API key. Codex authenticates
            // via the user's subscription (`codex login`) and reads its model
            // from ~/.codex/config.toml, so no model/provider is set here.
            backend: { type: "local" },
          });
          console.info(`[jarvis] seeded agent "${seed.name}" on ${runtime.id}`);
        } catch (e) {
          console.warn(`[jarvis] seeding "${seed.name}" failed:`, e);
        }
      }
    })();
  }, [ready]);
}
