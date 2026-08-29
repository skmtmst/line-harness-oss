export interface ResolveLineTokenInput {
  accountToken: string | null | undefined;
  defaultToken: string;
  accountId: string | null | undefined;
  context: string;
}

export function recordLineTokenDefaultFallback(input: {
  accountId: string | null;
  context: string;
}): void {
  console.log(JSON.stringify({
    event: 'line_token_default_fallback',
    accountId: input.accountId ?? null,
    context: input.context,
  }));
}

/**
 * Preserve the existing default-token fallback while making each actual
 * fallback observable in Worker logs. Never add token or recipient data here.
 */
export function resolveLineToken(input: ResolveLineTokenInput): string {
  if (input.accountToken) return input.accountToken;

  recordLineTokenDefaultFallback({
    accountId: input.accountId ?? null,
    context: input.context,
  });
  return input.defaultToken;
}
