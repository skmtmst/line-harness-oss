/**
 * LINE に登録されている Webhook の宛先を読み、こちらの受け口と突き合わせる。
 *
 * `LineAccount.webhook` は型だけあって、**誰も値を入れていなかった**（台帳 #134）。
 * 入れないままだと、はじめの設定の段1（「Webhookが合っていて」）が
 * いつまでも終わらない。
 *
 * **「合っている」と「確かめていない」を言い分ける。**
 * どちらも届かないかもしれないが、運用者のやることが違う——
 * 前者は直す、後者は確かめる。
 */

export type WebhookMatchStatus = 'matched' | 'mismatched' | 'unconfigured' | 'unknown';

export interface WebhookCheck {
  expectedUrl: string;
  actualUrl: string | null;
  /** LINE 側で Webhook の利用がオンか。読めなければ null。 */
  active: boolean | null;
  status: WebhookMatchStatus;
}

/** こちらの受け口。`webhook.ts` の `POST /webhook` と揃える。 */
export function expectedWebhookUrl(workerUrl: string): string {
  return `${workerUrl.replace(/\/+$/, '')}/webhook`;
}

/**
 * 末尾のスラッシュだけの違いを「違う」と言わない。
 * LINE の管理画面は付けたり付けなかったりする。
 */
function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

export function compareWebhookUrl(expected: string, actual: string | null | undefined): WebhookMatchStatus {
  if (actual === undefined) return 'unknown';
  if (actual === null || actual === '') return 'unconfigured';
  return sameUrl(expected, actual) ? 'matched' : 'mismatched';
}

/**
 * LINE から Webhook の宛先を読む。
 *
 * **読めなかったことを「登録されていない」と読まない。** 通信が失敗した、
 * トークンが切れた、というだけで「未登録」と出すと、運用者は
 * 直っているものを直しに行く。読めなければ `unknown`。
 */
export async function fetchWebhookEndpoint(
  accessToken: string,
  expectedUrl: string,
): Promise<WebhookCheck> {
  const unknown: WebhookCheck = { expectedUrl, actualUrl: null, active: null, status: 'unknown' };
  try {
    const res = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    // 404 は「まだ登録していない」。LINE がそう返す。
    if (res.status === 404) {
      return { expectedUrl, actualUrl: null, active: null, status: 'unconfigured' };
    }
    if (!res.ok) return unknown;
    const data = (await res.json()) as { endpoint?: string; active?: boolean };
    const actual = typeof data.endpoint === 'string' ? data.endpoint : null;
    return {
      expectedUrl,
      actualUrl: actual,
      active: typeof data.active === 'boolean' ? data.active : null,
      status: compareWebhookUrl(expectedUrl, actual),
    };
  } catch {
    return unknown;
  }
}
