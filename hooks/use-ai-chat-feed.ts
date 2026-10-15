"use client";

import { useCallback, useEffect, useState } from "react";
import { useFeedMessages, useStatus } from "@liveblocks/react";

const AI_CHAT_FEED_ID = "ai-chat";
const PAGE_SIZE = 50;
const MAX_AUTO_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2_000;

/**
 * `useFeedMessages("ai-chat")` with retries.
 *
 * Liveblocks fetches feed messages over the room websocket with a fixed 5s
 * timeout that starts as soon as the hook mounts — even while the socket is
 * still waiting on /api/liveblocks-auth (slow on a cold start) — and never
 * retries a failed initial fetch. The failed result is cached per query key, so
 * remounting doesn't help either. Bumping the page size by one per attempt
 * yields a fresh query key, and therefore a fresh fetch, without changing which
 * messages are shown (messages live in a store keyed by feed id, not query).
 */
export function useAiChatFeed() {
  const status = useStatus();
  const [attempt, setAttempt] = useState(0);
  const result = useFeedMessages(AI_CHAT_FEED_ID, { limit: PAGE_SIZE + attempt });
  const { error } = result;

  useEffect(() => {
    if (!error) return;
    console.error(`Failed to load ${AI_CHAT_FEED_ID} feed (attempt ${attempt + 1})`, error);
    // Wait for the socket to (re)connect before retrying; this effect re-runs
    // when `status` changes.
    if (status !== "connected" || attempt >= MAX_AUTO_ATTEMPTS - 1) return;
    const timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_BASE_DELAY_MS * (attempt + 1));
    return () => clearTimeout(timer);
  }, [error, attempt, status]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...result, retry };
}
