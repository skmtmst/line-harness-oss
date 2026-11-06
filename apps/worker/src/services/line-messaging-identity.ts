/** bot/info の成功だけでは別店舗のトークンも通るため、手入力の送信資格情報を受信の秘密値と同じチャネルへ結ぶ。LINE 応答と秘密値はブラウザ・ログへ返さない。 */
export async function verifyLineMessagingIdentity(input: {
  channelId: string;
  channelSecret: string;
  channelAccessToken: string;
}): Promise<boolean> {
  if (!/^\d+$/.test(input.channelId) || !input.channelSecret || !input.channelAccessToken) return false;
  try {
    // 15分の短期確認とし、既存送信トークンの30個上限を消費しない。確認用トークンは保存・返却しない。
    const proof = await fetch('https://api.line.me/oauth2/v3/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: input.channelId, client_secret: input.channelSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!proof.ok) return false;
    const issued = await proof.json<{ access_token?: unknown }>();
    if (typeof issued.access_token !== 'string' || !issued.access_token) return false;
    const botId = async (token: string): Promise<string | null> => {
      const response = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const body = await response.json<{ userId?: unknown }>();
      return typeof body.userId === 'string' && body.userId.length > 0 ? body.userId : null;
    };
    const [issuedBot, suppliedBot] = await Promise.all([botId(issued.access_token), botId(input.channelAccessToken)]);
    return issuedBot !== null && issuedBot === suppliedBot;
  } catch {
    return false;
  }
}
