import * as React from "react";

import { relayClient } from "@/shared/api/relayClient";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * The agent's *actual* answer, read from the channel.
 *
 * Buzz's base prompt (injected by the harness above any persona) tells agents:
 * "If your turn produced anything worth knowing, you MUST publish it. Use
 * `buzz messages send`." So the substantive answer goes to the channel as a
 * kind:9 message, while the agent's final ACP message is often just a summary
 * ("Replied in the correct Buzz thread"). Reading the ACP transcript therefore
 * shows — and speaks — a status line instead of the answer.
 *
 * This mirrors what the huddle's TTS does (`useTtsSubscription`): subscribe to
 * the channel's live messages and take the newest one authored by the agent.
 */
export type JarvisAgentReply = { id: string; text: string } | null;

export function useJarvisAgentReply(
  channelId: string | null,
  agentPubkey: string | null,
): JarvisAgentReply {
  const [reply, setReply] = React.useState<JarvisAgentReply>(null);

  React.useEffect(() => {
    setReply(null);
    if (!channelId || !agentPubkey) return;

    const wanted = normalizePubkey(agentPubkey);
    let disposed = false;
    let cleanup: (() => void) | null = null;
    const seen = new Set<string>();

    relayClient
      .subscribeToChannelLive(channelId, (event) => {
        if (disposed) return;
        if (event.kind !== 9) return;
        if (normalizePubkey(event.pubkey) !== wanted) return;
        if (seen.has(event.id)) return;
        seen.add(event.id);
        const text = event.content.trim();
        // Skip empties and legacy "[System]" chatter, mirroring the huddle.
        if (text.length <= 1 || text.startsWith("[System]")) return;
        setReply({ id: event.id, text });
      })
      .then((dispose) => {
        if (disposed) {
          void dispose();
          return;
        }
        cleanup = () => void dispose();
      })
      .catch((err) => {
        console.warn("[jarvis] reply subscription failed:", err);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [channelId, agentPubkey]);

  return reply;
}
