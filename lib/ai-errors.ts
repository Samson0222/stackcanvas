// Dependency-free so it can be shared by Trigger.dev tasks and client components.

const QUOTA_ERROR_PATTERN = /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i;
const BILLING_ERROR_PATTERN = /prepayment credits are depleted|billing/i;

export function isQuotaErrorMessage(message: string | undefined | null): boolean {
  return !!message && QUOTA_ERROR_PATTERN.test(message);
}

/** User-facing text for a failed AI run, based on the run's error message. */
export function describeAiFailure(message: string | undefined | null, fallback: string): string {
  if (isQuotaErrorMessage(message)) {
    return "The AI provider's usage limit was reached. Wait a minute and try again.";
  }
  if (message && BILLING_ERROR_PATTERN.test(message)) {
    return "The AI provider account is out of credits. Ask the project owner to top up billing.";
  }
  return fallback;
}
