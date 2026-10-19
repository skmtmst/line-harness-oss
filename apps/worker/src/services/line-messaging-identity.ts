/** Bind manually supplied send credentials to the same channel as the receive secret.
 * A successful bot/info call alone cannot prove this: it may be another shop's token.
 * Nothing from LINE responses or credentials is returned to the browser/logs.
 */
export async function verifyLineMessagingIdentity(input: {
  channelId: string;
  channelSecret: string;
  channelAccessToken: string;
}): Promise<boolean> {
  if (!/^\d+$/.test(input.channelId) || !input.channelSecret || !input.channelAccessToken) return false;
  try {
    // Stateless proof expires in 15 minutes and never displaces existing send
    // credentials from LINE's 30-token quota. Do not persist or return it.
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
