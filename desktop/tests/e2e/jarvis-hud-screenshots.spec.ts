import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const SHOTS = "test-results/jarvis-hud";

// Reuse a known mock identity so the bridge already understands this pubkey.
const JARVIS_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301"; // #agents
const NOW = new Date("2025-06-15T12:00:00Z").toISOString();

const MANAGED_AGENTS = [
  {
    pubkey: JARVIS_PUBKEY,
    name: "Jarvis Concierge",
    status: "running" as const,
    channelNames: ["agents"],
  },
];

type SeedEvent = {
  seq: number;
  timestamp: string;
  kind: string;
  agentIndex: number | null;
  channelId: string | null;
  sessionId: string | null;
  turnId: string | null;
  payload: unknown;
};

function sessionUpdate(seq: number, update: unknown): SeedEvent {
  return {
    seq,
    timestamp: NOW,
    kind: "acp_read",
    agentIndex: 0,
    channelId: CHANNEL_ID,
    sessionId: "session-jarvis",
    turnId: "turn-jarvis",
    payload: {
      method: "session/update",
      params: { sessionId: "session-jarvis", update },
    },
  };
}

async function seed(
  page: import("@playwright/test").Page,
  events: SeedEvent[],
) {
  await page.evaluate(
    ({ pubkey, evts }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: pubkey,
        events: evts,
      });
    },
    { pubkey: JARVIS_PUBKEY, evts: events },
  );
  await page.waitForTimeout(300);
}

async function openHud(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
    null,
    { timeout: 10_000 },
  );
  await page.getByTestId("jarvis-launcher").click();
  const hud = page.getByTestId("jarvis-hud");
  await expect(hud).toBeVisible({ timeout: 10_000 });
  return hud;
}

test.describe("JARVIS HUD", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("settled reply — reactor, response, action log", async ({ page }) => {
    await installMockBridge(page, { managedAgents: MANAGED_AGENTS });
    const hud = await openHud(page);

    await seed(page, [
      {
        seq: 1,
        timestamp: NOW,
        kind: "turn_started",
        agentIndex: 0,
        channelId: CHANNEL_ID,
        sessionId: null,
        turnId: "turn-jarvis",
        payload: { source: "channel", triggeringEventIds: [] },
      },
      sessionUpdate(2, {
        sessionUpdate: "agent_thought_chunk",
        content: {
          type: "text",
          text: "This is a VasyERP question — routing to the receivables report.",
        },
      }),
      sessionUpdate(3, {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        status: "executing",
        title: "shell",
        kind: "shell",
        rawInput: { command: "vasyerp report receivables --json" },
      }),
      sessionUpdate(4, {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
      }),
      sessionUpdate(5, {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: {
          type: "text",
          text: "Receivables are about one lakh fifty-two thousand rupees, with thirty-seven invoices overdue. Purva is the biggest debtor at roughly seventy-three thousand.",
        },
      }),
      {
        seq: 6,
        timestamp: NOW,
        kind: "turn_completed",
        agentIndex: 0,
        channelId: CHANNEL_ID,
        sessionId: "session-jarvis",
        turnId: "turn-jarvis",
        payload: { tokens: 1840 },
      },
    ]);

    await expect(hud.getByTestId("jarvis-response")).toContainText(
      "Receivables are about",
      { timeout: 5_000 },
    );
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/01-settled-reply.png` });
  });

  test("standby — no activity yet", async ({ page }) => {
    await installMockBridge(page, { managedAgents: MANAGED_AGENTS });
    const hud = await openHud(page);

    await expect(hud.getByText("STANDING BY", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/02-standby.png` });
  });
});
