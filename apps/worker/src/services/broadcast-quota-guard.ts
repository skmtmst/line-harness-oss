/**
 * 予約配信を送る直前に、残りの送信枠を確かめる。
 *
 * 設計 `Bw0zt`（6-1-E 送信設定）の注意書きは
 * 「**予約時刻の直前に対象人数と送信枠を再確認します。**」と約束している。
 * 対象人数は `processSegmentSend` が送信時に数え直していたが、
 * **送信枠は誰も見ていなかった。**
 *
 * 予約したあとに枠を使い切ると、**予約は実行されるが途中で失敗する。**
 * 送った人と送れなかった人が混ざり、運用者は結果を見るまで気づけない。
 * 足りないと分かった時点で送らないほうが、あとから追いかけやすい。
 *
 * **取れないときは止めない。** LINE の口が落ちているだけで予約を潰すと、
 * 送れるはずの配信が届かなくなる。分からないものは分からないと記録して
 * 通す（`state: 'unknown'`）。
 */

export type QuotaCheck =
  | { state: 'ok'; limit: number; used: number; remaining: number }
  | { state: 'short'; limit: number; used: number; remaining: number; shortfall: number }
  /** 上限が無い（無制限）か、口が答えなかった。**止める理由にしない。** */
  | { state: 'unknown'; reason: string };

type QuotaFetch = {
  /** `GET /v2/bot/message/quota` */
  limit: number | null;
  /** `GET /v2/bot/message/quota/consumption` */
  used: number | null;
};

/**
 * 残りの枠と、これから送る通数を突き合わせる。
 *
 * **1人1通で数える。** 吹き出しを複数持つ配信でも、LINE の集計は
 * 「送った人数」ではなく「送ったメッセージ数」なので、呼ぶ側が
 * 通数を渡す。
 */
export function evaluateQuota(fetched: QuotaFetch, planned: number): QuotaCheck {
  if (fetched.limit === null) {
    return { state: 'unknown', reason: '送信枠の上限を取得できませんでした' };
  }
  if (fetched.used === null) {
    return { state: 'unknown', reason: '今月の送信数を取得できませんでした' };
  }
  const remaining = Math.max(0, fetched.limit - fetched.used);
  if (planned > remaining) {
    return {
      state: 'short',
      limit: fetched.limit,
      used: fetched.used,
      remaining,
      shortfall: planned - remaining,
    };
  }
  return { state: 'ok', limit: fetched.limit, used: fetched.used, remaining };
}

/**
 * 足りないときに運用者へ出す文。
 *
 * **内部の語も番号も出さない。** 何通足りないか、次に何をすればよいかを書く。
 */
export function shortfallMessage(check: Extract<QuotaCheck, { state: 'short' }>, planned: number): string {
  return (
    `送ろうとした ${planned.toLocaleString('ja-JP')}通 に対して、`
    + `今月の残りが ${check.remaining.toLocaleString('ja-JP')}通 しかありません`
    + `（${check.shortfall.toLocaleString('ja-JP')}通 足りません）。`
    + 'この配信は送らずに下書きへ戻しました。'
    + '送る相手を減らすか、来月に予約し直してください。'
  )
}

/** LINE から上限と使用数を読む。**落ちても投げない**（`null` にして呼ぶ側で判断する）。 */
export async function fetchQuota(channelAccessToken: string): Promise<QuotaFetch> {
  const headers = { Authorization: `Bearer ${channelAccessToken}` };
  const read = async (path: string, pick: (json: Record<string, unknown>) => number | null) => {
    try {
      const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return pick((await res.json()) as Record<string, unknown>);
    } catch {
      return null;
    }
  };
  const [limit, used] = await Promise.all([
    read('quota', (json) =>
      json.type === 'limited' && typeof json.value === 'number' ? json.value : null,
    ),
    read('quota/consumption', (json) =>
      typeof json.totalUsage === 'number' ? json.totalUsage : null,
    ),
  ]);
  return { limit, used };
}
