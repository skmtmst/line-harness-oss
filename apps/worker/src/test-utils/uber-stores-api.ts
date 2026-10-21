import { vi } from 'vitest';

export type UberStoresApiOptions = {
  stores?: Array<Record<string, unknown>>;
  listStatus?: number;
  posStatus?: number;
};

/**
 * Uber の口の作り物。一覧と連携の有効化だけを受ける。
 * beforeEach の既定の受け口を置き換えるので、呼び先と回数をここで数える。
 */
export function stubUberStoresApi(
  defaults: { store: () => Record<string, unknown>; providerFreeText: string },
  options: UberStoresApiOptions = {},
): Array<{ url: string; method: string; body: string }> {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      const headers = { 'content-type': 'application/json' };
      if (url.endsWith('/pos_data')) {
        const status = options.posStatus ?? 200;
        if (status === 200) return new Response(null, { status: 204 });
        // 失敗の本文に業者の生文が混ざっていても、こちらへは残らないこと。
        return new Response(JSON.stringify({ message: defaults.providerFreeText }), { status, headers });
      }
      const status = options.listStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ message: defaults.providerFreeText }), { status, headers });
      }
      return new Response(JSON.stringify({ stores: options.stores ?? [defaults.store()] }), {
        status: 200,
        headers,
      });
    }),
  );
  return calls;
}
