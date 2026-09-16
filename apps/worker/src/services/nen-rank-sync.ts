import type { NenLifetimeMilestone, NenRankRules, NenRankSetting } from '@line-crm/db';

/**
 * 会員ランクの設定を EC-CUBE へ署名付きで送る（★V6 37-1-A「保存してECへ同期」）。
 *
 * 署名の作り方はクーポン送信（`eccube-coupon.ts`）と同じ：
 * `X-Nen-Timestamp` と `X-Nen-Signature: sha256=HMAC-SHA256(timestamp + '.' + body)`。
 * EC側は `version` で冪等に受け取る（同じ版は上書きしない）。
 *
 * 設定の正本はLINE側。ランク・マイルの計算はEC側（注文の正本があるため）。
 */

export type NenRankSyncPayload = {
  version: number;
  ranks: Array<{ key: string; name: string; annual_threshold_yen: number; mile_rate_percent: number }>;
  rules: {
    year_start_month: number;
    apply_on_reach: string;
    keep_until: string;
    count_orders: string;
  };
  lifetime_milestones: Array<{ threshold_yen: number; title: string; notify_on_reach: boolean }>;
};

export function buildNenRankSyncPayload(
  ranks: NenRankSetting[],
  rules: NenRankRules,
  milestones: NenLifetimeMilestone[],
): NenRankSyncPayload {
  return {
    version: rules.version,
    ranks: [...ranks]
      .sort((a, b) => a.annual_threshold_yen - b.annual_threshold_yen)
      .map((rank) => ({
        key: rank.rank_key,
        name: rank.name,
        annual_threshold_yen: rank.annual_threshold_yen,
        mile_rate_percent: rank.mile_rate_percent,
      })),
    rules: {
      year_start_month: rules.year_start_month,
      apply_on_reach: rules.apply_on_reach,
      keep_until: rules.keep_until,
      count_orders: rules.count_orders,
    },
    lifetime_milestones: [...milestones]
      .sort((a, b) => a.threshold_yen - b.threshold_yen)
      .map((milestone) => ({
        threshold_yen: milestone.threshold_yen,
        title: milestone.title,
        notify_on_reach: milestone.notify_on_reach === 1,
      })),
  };
}

export class NenRankSyncError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'NenRankSyncError';
  }
}

export async function pushNenRankSettingsToEc(
  baseUrl: string,
  secret: string,
  payload: NenRankSyncPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/$/, '')}/line-harness/rank-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nen-Timestamp': timestamp,
        'X-Nen-Signature': `sha256=${signature}`,
      },
      body,
    });
  } catch {
    throw new NenRankSyncError('ECにつながりませんでした。時間をおいてもう一度お試しください', null);
  }
  // 409 は「同じ版をすでに受け取っている」。設定は届いているので成功として扱う。
  if (response.ok || response.status === 409) return;
  throw new NenRankSyncError(
    response.status === 401
      ? 'ECが署名を受け付けませんでした。つなぎ先の秘密の設定を確認してください'
      : response.status === 404
        ? 'ECにランク設定の受け口がありません（EC側の更新が必要です）'
        : `ECがエラーを返しました（${response.status}）`,
    response.status,
  );
}
