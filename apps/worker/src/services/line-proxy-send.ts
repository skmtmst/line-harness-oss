import type { Message } from '@line-crm/line-sdk';
import type { OperationCapability } from '@line-crm/db';
import { OPERATION_PROXY_CAPABILITY_HEADER } from './operation-send-paths.js';

export type HarnessProxyDispatch = (request: Request) => Promise<Response>;

/**
 * LINE の push は必ず Harness の互換プロキシを通す。
 * プロキシ側が送信履歴の記録も担当するため、呼び出し元で messages_log を
 * 二重に書かないこと。
 *
 * #1050: capability を渡すと X-Line-Harness-Capability として名乗り、
 * プロキシの緊急停止判定がその停止対象を見る。省略時はプロキシ側で
 * broadcast_dispatch (安全側) として扱われる。
 */
export async function pushViaHarnessProxy(
  proxyBaseUrl: string,
  accessToken: string,
  to: string,
  messages: Message[],
  retryKey?: string,
  dispatch?: HarnessProxyDispatch,
  capability?: OperationCapability,
): Promise<{ requestId: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (retryKey) headers['X-Line-Retry-Key'] = retryKey;
  if (capability) headers[OPERATION_PROXY_CAPABILITY_HEADER] = capability;

  const url = `${proxyBaseUrl.replace(/\/$/, '')}/line-api/v2/bot/message/push`;
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, messages }),
  };
  // Worker 自身の公開 URL へ fetch すると自己接続が失敗する環境がある。
  // 内部呼び出しは同じ Hono proxy handler へ直接 dispatch し、外部利用時だけ fetch。
  const response = dispatch ? await dispatch(new Request(url, init)) : await fetch(url, init);

  // 同じ retry key がすでに LINE に受理済みなら、再送の 409 も成功扱い。
  const alreadyAccepted =
    response.status === 409 && Boolean(response.headers.get('x-line-accepted-request-id'));
  if (response.ok || alreadyAccepted) {
    return {
      requestId: response.headers.get('x-line-request-id')
        ?? response.headers.get('x-line-accepted-request-id'),
    };
  }

  const body = await response.text().catch(() => '');
  const error = new Error(
    `LINE Harness proxy error: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`,
  );
  Object.assign(error, {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
  });
  throw error;
}
