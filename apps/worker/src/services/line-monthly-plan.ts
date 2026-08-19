export type LineMonthlyPlanKey = 'communication' | 'light' | 'standard' | 'unknown';

export type LineMonthlyPlan = {
  key: LineMonthlyPlanKey;
  label: string;
  monthlyMessageLimit: number | null;
  source: 'messaging-api-quota';
};

/**
 * LINE Messaging API が返す当月の送信上限から、日本向け月額プランを判定する。
 *
 * LINE API にはプラン名の取得APIがないため、公式料金表の無料メッセージ数を
 * 根拠にする。スタンダードだけは追加メッセージを購入でき、APIの上限が
 * 30,000より大きくなることがあるため `>= 30,000` として扱う。
 */
export function classifyLineMonthlyPlan(limit: number | null): LineMonthlyPlan {
  const base = { monthlyMessageLimit: limit, source: 'messaging-api-quota' as const };
  if (limit === 200) return { ...base, key: 'communication', label: 'コミュニケーション' };
  if (limit === 5_000) return { ...base, key: 'light', label: 'ライト' };
  if (limit !== null && limit >= 30_000) return { ...base, key: 'standard', label: 'スタンダード' };
  return { ...base, key: 'unknown', label: '取得できません' };
}

/** LINEから当月の送信上限を読み、一覧表示用のプランへ変換する。 */
export async function fetchLineMonthlyPlan(channelAccessToken: string): Promise<LineMonthlyPlan> {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/quota', {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    });
    if (!response.ok) return classifyLineMonthlyPlan(null);
    const quota = await response.json<{ type?: string; value?: number }>();
    const limit = quota.type === 'limited' && typeof quota.value === 'number' ? quota.value : null;
    return classifyLineMonthlyPlan(limit);
  } catch {
    return classifyLineMonthlyPlan(null);
  }
}
