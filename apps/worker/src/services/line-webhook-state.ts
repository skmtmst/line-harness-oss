export type WebhookEndpointState = {
  expectedUrl: string;
  actualUrl: string | null;
  active: boolean | null;
  status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown';
};

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
