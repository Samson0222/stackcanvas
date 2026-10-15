// Dependency-free so it can be shared by Trigger.dev tasks and client components.

const QUOTA_ERROR_PATTERN = /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i;

export function isQuotaErrorMessage(message: string | undefined | null): boolean {
  return !!message && QUOTA_ERROR_PATTERN.test(message);
}

export const QUOTA_ERROR_USER_MESSAGE =
  "The AI provider's usage limit was reached. Wait a minute and try again.";
