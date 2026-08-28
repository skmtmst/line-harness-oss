export type WebhookEndpointState = {
  expectedUrl: string;
  actualUrl: string | null;
  active: boolean | null;
  status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown';
};

export type WebhookSetupResult = 'ok' | 'inactive' | 'failed';

/** URL設定と疎通確認を行う。失敗はアカウント作成を妨げず、秘密値を返さない。 */
export async function configureWebhookEndpoint(
  channelAccessToken: string,
  expectedUrl: string,
): Promise<WebhookSetupResult> {
  try {
    const headers = {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    };
    const update = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ endpoint: expectedUrl }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!update.ok) return 'failed';

    const test = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (!test.ok) return 'failed';

    const state = await fetchWebhookEndpointState(channelAccessToken, expectedUrl);
    if (state.active === false) return 'inactive';
    return state.status === 'matched' ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * LINE Developersに登録されたWebhook URLを読み取る。
 * 設定変更や接続テストは行わず、資格情報をログ・例外へ含めない。
 */
export async function fetchWebhookEndpointState(
  channelAccessToken: string,
  expectedUrl: string,
): Promise<WebhookEndpointState> {
  try {
    const response = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { expectedUrl, actualUrl: null, active: null, status: 'unknown' };
    }
    const endpoint = await response.json<{ endpoint?: string; active?: boolean }>();
    const actualUrl = endpoint.endpoint?.trim() || null;
    const active = endpoint.active === true;
    const status: WebhookEndpointState['status'] = !actualUrl
      ? 'unconfigured'
      : actualUrl === expectedUrl && active
        ? 'matched'
        : 'mismatched';
    return { expectedUrl, actualUrl, active, status };
  } catch {
    return { expectedUrl, actualUrl: null, active: null, status: 'unknown' };
  }
}
