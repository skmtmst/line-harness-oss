import { issueLineAccessToken } from './token-refresh.js';

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
    const issued = await issueLineAccessToken(input.channelId, input.channelSecret);
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
