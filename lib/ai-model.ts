import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, RetryError, type LanguageModel } from "ai";
import { isQuotaErrorMessage } from "@/lib/ai-errors";

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

// Longest per-minute quota window worth waiting out before retrying a run.
const MAX_QUOTA_RETRY_DELAY_MS = 120_000;

/**
 * Model ids to try in order. Configurable via env vars so a retired model or an
 * exhausted quota can be handled from the Trigger.dev dashboard without a redeploy.
 * Each Gemini model has its own free-tier quota, so a fallback model keeps
 * working when the primary one is rate limited.
 */
function getGeminiModelIds(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

/**
 * Runs `call` against the primary Gemini model, failing over to the fallback
 * model only when the primary's quota is exhausted. Callers should pass
 * `maxRetries: 0` to the AI SDK: retries are owned by Trigger.dev, and the AI
 * SDK's own default of 2 retries would triple the requests sent per attempt.
 */
export async function withGeminiModel<T>(call: (model: LanguageModel) => Promise<T>): Promise<T> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY environment variable is required");
  }
  const google = createGoogleGenerativeAI({ apiKey });

  let lastError: unknown;
  for (const modelId of getGeminiModelIds()) {
    try {
      return await call(google(modelId));
    } catch (err) {
      lastError = err;
      if (!getQuotaInfo(err)) throw err;
    }
  }
  throw lastError;
}

interface QuotaInfo {
  /** Delay Google asked us to wait before retrying, if it provided one. */
  retryDelayMs?: number;
  /** Daily quotas won't reset within any reasonable retry window. */
  isDaily: boolean;
}

function getQuotaInfo(err: unknown): QuotaInfo | null {
  const cause = RetryError.isInstance(err) ? err.lastError : err;
  const isApiError = APICallError.isInstance(cause);
  const text = isApiError
    ? `${cause.message} ${cause.responseBody ?? ""}`
    : cause instanceof Error
      ? cause.message
      : String(cause);

  if (!(isApiError && cause.statusCode === 429) && !isQuotaErrorMessage(text)) {
    return null;
  }

  const delayMatch =
    text.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/) ?? text.match(/retry in (\d+(?:\.\d+)?)s/i);
  return {
    retryDelayMs: delayMatch ? Math.ceil(Number(delayMatch[1]) * 1000) : undefined,
    isDaily: /PerDay/i.test(text),
  };
}

/**
 * How long to wait before retrying a quota error, or `null` when retrying is
 * pointless (daily quota, or a reset window too long to wait out). Returns
 * `undefined` for non-quota errors so the task's normal retry policy applies.
 */
export function getQuotaRetryDelayMs(err: unknown): number | null | undefined {
  const quota = getQuotaInfo(err);
  if (!quota) return undefined;
  const delayMs = (quota.retryDelayMs ?? 60_000) + 1_000;
  if (quota.isDaily || delayMs > MAX_QUOTA_RETRY_DELAY_MS) return null;
  return delayMs;
}

/**
 * Shared `catchError` for Gemini-backed tasks: waits out a per-minute quota
 * window instead of burning every retry inside it, and stops retrying when the
 * quota can't recover in time.
 */
export function handleGeminiTaskError({ error }: { error: unknown }) {
  const delayMs = getQuotaRetryDelayMs(error);
  if (delayMs === undefined) return undefined;
  if (delayMs === null) return { skipRetrying: true };
  return { retryAt: new Date(Date.now() + delayMs) };
}
