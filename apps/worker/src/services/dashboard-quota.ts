import { lineTransport } from '../lib/external-call/line.js';

interface QuotaResult {
  limit: number | null;
  used: number | null;
  /** LINE 側が type=none を返した「上限なし」の契約。limit=null と取得失敗を分ける（DASH-08）。 */
  unlimited: boolean;
  failed: boolean;
  reason: 'not_connected' | 'fetch_failed' | null;
  asOf: string | null;
}

export async function fetchQuota(
  token: string | undefined,
  timeoutMs = 10_000,
): Promise<QuotaResult> {
  if (!token) {
    return { limit: null, used: null, unlimited: false, failed: false, reason: 'not_connected', asOf: null };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  const transport = lineTransport(signal);
  let cancel!: () => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new Error('quota_timeout'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([deadline, (async (): Promise<QuotaResult> => {
      const [quota, consumption] = await Promise.all([
        transport('https://api.line.me/v2/bot/message/quota', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        transport('https://api.line.me/v2/bot/message/quota/consumption', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!quota.ok || !consumption.ok) {
        return { limit: null, used: null, unlimited: false, failed: true, reason: 'fetch_failed', asOf: null };
      }
      // type が 'none' のときは上限なし。数字が入らないので null のままにする。
      const q = (await quota.json()) as { type?: string; value?: number };
      const c = (await consumption.json()) as { totalUsage?: number };
      const limit = q.type === 'limited' && typeof q.value === 'number' ? q.value : null;
      const used = typeof c.totalUsage === 'number' ? c.totalUsage : null;
      if ((q.type !== 'limited' && q.type !== 'none') || used === null || (q.type === 'limited' && limit === null)) {
        return { limit: null, used: null, unlimited: false, failed: true, reason: 'fetch_failed', asOf: null };
      }
      return { limit, used, unlimited: q.type === 'none', failed: false, reason: null, asOf: new Date().toISOString() };
    })()]);
  } catch {
    return { limit: null, used: null, unlimited: false, failed: true, reason: 'fetch_failed', asOf: null };
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
