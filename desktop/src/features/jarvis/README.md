# JARVIS voice HUD

An Ironman/JARVIS-style heads-up display for talking to a **concierge agent** and
watching its live reasoning. It is a self-contained overlay baked into the
desktop app — it does **not** rebuild any voice or agent plumbing, it *consumes*
what Buzz already has.

## What it does

- **Full-screen HUD overlay** (`ui/JarvisHud.tsx`) — animated arc reactor + radar,
  a live **action log**, the concierge's **response** text, a status bar, slash
  quick-commands, a text input, and a **Kill Voice** button.
- **Picks the concierge automatically** (`lib/useJarvisTarget.ts`) — the managed
  agent whose name contains "jarvis"/"concierge", or a user-selected one.
- **Live activity** comes straight from the observer relay: `useAgentTranscript`
  + `useActiveAgentTurns` (the same decoded telemetry the agent Activity panel
  uses). The reactor pulses while a turn is in flight.
- **Speaks replies** via the native Pocket TTS command `speak_agent_message`
  (`lib/useJarvisVoice.ts`) — the same one huddles use. Sequential,
  non-overlapping playback is owned by the Rust backend. The kill switch
  suppresses the current/queued speech while the text keeps streaming.

## How to open it

- Hotkey **⌘J / Ctrl+J**, or click the launcher chip (bottom-right).
- **Esc** closes it.

## Talking to it (voice)

**Push-to-talk is built and huddle-independent.** Hold the mic button (or the
text input works too), speak, release — the HUD:

1. runs a **decoupled STT session** in Rust (`src-tauri/src/jarvis_voice.rs`):
   its own `SttPipeline` (the same sherpa Parakeet recognizer) driven by a
   push-to-talk flag, with **no** `HuddleState` coupling and **no** relay post;
2. emits each finalized utterance as a `jarvis-transcript` Tauri event
   (`lib/useJarvisPushToTalk.ts` captures the mic via the shared `worklet.js`
   and streams f32/48kHz PCM to `jarvis_push_audio`);
3. sends that text to the concierge as an explicit @mention
   (`sendChannelMessage`), so the agent always triggers;
4. speaks the reply via browser **`speechSynthesis`** (`lib/useJarvisVoice.ts`) —
   the native Pocket TTS command is huddle-gated, so the HUD uses the Web Speech
   fallback the reference playbook specifies. **Kill Voice** cancels it.

The one bootstrap caveat: sending needs a channel the concierge is in. Once
you've talked to it once (voice or text) in a channel, that channel sticks for
the session. The huddle voice loop still works too, independently.

## Wiring (all reused, nothing new in Rust)

| Concern | Source |
|---|---|
| Live transcript / reactor | `@/features/agents/observerRelayStore`, `activeAgentTurnsStore` |
| TTS out | `speak_agent_message` (native, `desktop/src-tauri/src/huddle/tts.rs`) |
| Send to agent | `sendChannelMessage` (`@/shared/api/tauri`) |
| Agent list | `useManagedAgentsQuery` |
| Overlay mount | `AppShell.tsx` (next to the other global overlays) |
| Community reset | `resetJarvisHudState` in `useCommunityInit.ts` |

## The concierge agent

Create an agent named **"Jarvis"** and paste the concierge persona
(`vasyerp-cli/agents/buzz-jarvis.buzz-system.md`) — one front agent that routes
questions to the HLP (mortgage) and VasyERP (ERP) read-only CLIs and replies in a
short, spoken style tuned for TTS.

## Gotchas worth knowing (each cost real debugging time)

- **Codex agents have no network by default.** The `codex-acp` adapter hardcodes
  its session sandbox: `DEFAULT_AGENT_MODE = "agent"` carries
  `networkAccess: false`, and Buzz's permission-mode values
  (`bypassPermissions`/…) are Claude-style ids the adapter ignores, so it falls
  back to that default. `~/.codex/config.toml` has **no effect** on this path.
  The fix is the adapter's own `INITIAL_AGENT_MODE=agent-full-access`, set as an
  agent env var by `useEnsureSeedAgents`. Agents must be **restarted** to pick it
  up — a config change alone does nothing to a running process.
- **Diagnosing it:** a network-blocked CLI call returns in ~0.17s with
  `session_valid: false`; a real one takes ~0.8s. Fast + false = no network, not
  an expired session. The agent will confidently report "session expired".
- **Agents only receive mentions in channels they belong to.** A freshly seeded
  agent is in none, so the HUD attaches it before sending; without that the
  message posts fine and the agent never sees it.
- **Agent persistence:** dev keychain writes for agent keys are unreliable, so
  agents are re-created from `~/.buzz/jarvis-seed-agents.json` on every startup.

## Verification

- `pnpm typecheck && pnpm check` (types, biome, file-sizes, px-text).
- `pnpm build:e2e && pnpm exec playwright test jarvis-hud-screenshots --project=smoke`
  renders the HUD with a mock concierge + seeded observer telemetry and captures
  `test-results/jarvis-hud/{01-settled-reply,02-standby}.png`.
