# JARVIS voice HUD

An Ironman/JARVIS-style heads-up display for talking to a **concierge agent** by
voice and watching its live reasoning. A self-contained overlay in the desktop
app, built on Buzz's own agent telemetry and voice models.

## What it does

- **Full-screen HUD overlay** (`ui/JarvisHud.tsx`) — animated arc reactor + radar,
  a live **action log**, the agent's **response**, a status bar, slash
  quick-commands, a text input, and a **Kill Voice** button.
- **Picks the concierge automatically** (`lib/useJarvisTarget.ts`) — the managed
  agent whose name contains "jarvis"/"concierge", else a user-selected one.
- **Live activity** from the observer relay: `useAgentTranscript` +
  `useActiveAgentTurns` — the same decoded telemetry the Activity panel uses.
  The reactor pulses while a turn is in flight.
- **Push-to-talk voice in**, **selectable voice out**, and the agent's answer
  shown *and* spoken.

## How to open it

- **⌘J / Ctrl+J**, or the launcher chip (bottom-right). **Esc** closes it.
- **Hold Space** (or hold the mic button) to talk. Space is ignored while typing
  in a text field.

## Voice in — push-to-talk, huddle-independent

1. A **decoupled STT session** in Rust (`src-tauri/src/jarvis_voice.rs`) runs its
   own `SttPipeline` (sherpa Parakeet) behind a push-to-talk flag — no
   `HuddleState` coupling and no relay post.
2. `lib/useJarvisPushToTalk.ts` captures the mic via the shared `worklet.js` and
   streams f32/48 kHz PCM to `jarvis_push_audio`.
3. Each finalized utterance arrives as a `jarvis-transcript` Tauri event and is
   sent to the agent as an explicit @mention.

## Voice out — provider-selectable (Settings → JARVIS voice)

| Provider | Notes |
|---|---|
| **Built-in (Pocket TTS)** — default | `jarvis_speak` runs its own pipeline; the huddle's `speak_agent_message` is huddle-gated, so this lifts that gate the same way STT did. Free, offline, nothing leaves the machine. |
| **Google Chirp 3: HD** | `jarvis_google_tts` proxies Cloud TTS. ~1M chars/month free. Sends answer text to Google. |
| **System voice** | Web Speech API. Robotic, always available, used as the last-resort fallback. |
| **Off** | Text only. |

`lib/jarvisSpeech.ts` owns the behaviour: sentence chunking (first sentence plays
while the rest synthesises), strictly sequential playback, generation-counter
cancellation, and a fallback chain **google → pocket → browser** so a network
blip degrades the voice instead of silently killing it.

**Google auth is a service account, not an API key.** Cloud TTS rejects API keys
outright. Put the service-account JSON at `~/.buzz/jarvis-tts-google.json`; Rust
signs an RS256 JWT, exchanges it for an OAuth2 token, and caches it hourly. The
key and token never reach browser JS — the webview only receives audio bytes.

## What the HUD reads

The agent's **published channel message** is the answer — Buzz's base prompt
tells agents to publish substantive output with `buzz messages send`, so the ACP
assistant message is often just a summary ("Replied in the thread"). Reading the
ACP message would show and speak a status line instead of the answer, so
`lib/useJarvisAgentReply.ts` subscribes to the channel and takes the newest
message authored by the target agent, exactly as the huddle's TTS does. The ACP
message is only a fallback.

## Wiring

| Concern | Source |
|---|---|
| Live transcript / reactor | `@/features/agents/observerRelayStore`, `activeAgentTurnsStore` |
| The answer (shown + spoken) | `lib/useJarvisAgentReply.ts` (channel kind:9 from the agent) |
| Voice in | `jarvis_start_listening` / `jarvis_push_audio` / `jarvis_set_ptt` |
| Voice out | `jarvis_speak`, `jarvis_google_tts`, `jarvis_stop_speaking` |
| Send to agent | `sendChannelMessage`, auto-attaching via `attachManagedAgentToChannel` |
| Agent seeding | `lib/useEnsureSeedAgents.ts` ← `~/.buzz/jarvis-seed-agents.json` |
| Overlay mount | `AppShell.tsx`; settings section in `SettingsPanels.tsx` |

## The concierge agent

Agents are auto-created on startup from `~/.buzz/jarvis-seed-agents.json`
(`{name, systemPrompt}[]`) on the **codex** runtime, and existing ones are
corrected onto it. Personas live with their CLIs — e.g.
`vasyerp-cli/agents/buzz-jarvis.buzz-system.md`, a front agent routing to the
HLP (mortgage) and VasyERP (ERP) read-only CLIs in a short spoken style.

## Gotchas worth knowing (each cost real debugging time)

- **Codex agents have no network by default.** `codex-acp` hardcodes its sandbox:
  `DEFAULT_AGENT_MODE = "agent"` carries `networkAccess: false`, and Buzz's
  permission-mode values (`bypassPermissions`/…) are Claude-style ids the adapter
  ignores, so it silently falls back to that default. `~/.codex/config.toml` has
  **no effect** here. Fix: `INITIAL_AGENT_MODE=agent-full-access` as an agent env
  var (set by `useEnsureSeedAgents`). **Agents must be restarted** to pick it up.
- **A network block looks exactly like an expired session.** A blocked CLI call
  returns in ~0.17s with `session_valid: false`; a real one takes ~0.8s. Fast +
  false = no network. The agent will confidently insist the session expired.
- **Agents only receive mentions in channels they belong to.** A freshly seeded
  agent is in none, so the HUD attaches it before sending.
- **Cloud TTS rejects API keys** — service account only (see above).
- **Agent persistence:** dev keychain writes for agent keys are unreliable, so
  agents are re-seeded from the JSON file on every startup.

## Verification

- `pnpm typecheck && pnpm check` (types, biome, file-sizes, px-text, pubkey).
- `cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets`.
- `pnpm build:e2e && pnpm exec playwright test jarvis --project=smoke` — four
  specs: HUD settled-reply and standby renders, plus the settings provider picker
  and its cloud-privacy notice.
