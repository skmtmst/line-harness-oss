export interface LineQuotaResult {
  limit: number | null;
  used: number | null;
  failed: boolean;
}

/**
 * LINEの月間送信枠を読む共通口。
 *
 * 上限なしは limit=null、取得失敗は failed=true として区別する。
 * 画面や監視ごとに同じ外部APIを別実装しないため、ここを正本にする。
 */
export async function fetchLineQuota(token: string | undefined): Promise<LineQuotaResult> {
  if (!token) return { limit: null, used: null, failed: true };
  try {
    const [quota, consumption] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!quota.ok || !consumption.ok) return { limit: null, used: null, failed: true };
    const quotaBody = (await quota.json()) as { type?: string; value?: number };
    const consumptionBody = (await consumption.json()) as { totalUsage?: number };
    return {
      limit: quotaBody.type === 'limited' && typeof quotaBody.value === 'number'
        ? quotaBody.value
        : null,
      used: typeof consumptionBody.totalUsage === 'number' ? consumptionBody.totalUsage : null,
      failed: false,
    };
  } catch {
    return { limit: null, used: null, failed: true };
  }
}
