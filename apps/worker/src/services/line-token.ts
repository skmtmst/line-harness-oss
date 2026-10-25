import { logger } from '@line-crm/shared/server';
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
  logger.log("line_token_default_fallback");
}

/** 既定トークンの互換経路を保ちつつ、実際に代替したことをログで追えるようにする。トークンと宛先は記録しない。 */
export function resolveLineToken(input: ResolveLineTokenInput): string {
  if (input.accountToken) return input.accountToken;

  recordLineTokenDefaultFallback({
    accountId: input.accountId ?? null,
    context: input.context,
  });
  return input.defaultToken;
}
