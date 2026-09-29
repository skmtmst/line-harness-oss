import {
  getEntryRouteByRefCodeAny,
  recordEntryRouteStopSuppression,
  getActiveEntryRouteStopSuppression,
} from '@line-crm/db';
import type {
  EntryRouteStopSuppression,
  FriendAddCandidateSource,
} from '@line-crm/db';

// N-244: 停止した流入経路の判定を各入口 (/r/:ref、/auth/line、/auth/oauth、
// /auth/callback、/api/liff/*、follow webhook) で共通化する。
// entry_routes に行があり is_active != 1 のときだけ true (停止/アーカイブ)。
// 行自体が無い不存在 ref は共有 namespace の正規フロー (tracked/affiliate/
// 汎用受付) のため false のままにする。
// DB 読取に失敗したら fail-open せず true (受付・帰属・シナリオを止める側)
// に倒す。停止かどうかの判断材料が無いのに受付を続けると、止めたはずの
// 経路の計測・帰属・タグ/シナリオが増えるため。
// テスト用モックに関数が無いときだけ従来どおり false (実運用では常に
// 関数があるため、この分岐はテスト時のみ通る)。
export async function isStoppedEntryRouteRef(
  db: D1Database,
  ref: string | null | undefined,
): Promise<boolean> {
  const refCode = ref?.trim();
  if (!refCode || refCode.startsWith('xh:')) return false;
  // export 自体の有無と DB 読取の成否は分けて扱う。export が無いのは
  // 一部のテスト用モックだけで、実運用では常に存在する (同一パッケージの
  // 静的 import)。無いときは判定不能のため従来どおり false (通す側)。
  let lookup: typeof getEntryRouteByRefCodeAny | undefined;
  try {
    lookup = getEntryRouteByRefCodeAny;
  } catch {
    lookup = undefined;
  }
  if (typeof lookup !== 'function') return false;
  try {
    const anyRoute = await lookup(db, refCode);
    return !!anyRoute && anyRoute.is_active !== 1;
  } catch {
    return true;
  }
}

// N-244差戻(台帳): 停止試行の記録は失敗しても本線を壊さない。台帳が無い
// テスト用モックでは何もせず、DB失敗だけログに残す。
export async function recordStopSuppressionSafe(
  db: D1Database,
  input: {
    lineAccountId: string | null | undefined;
    lineUserId: string | null | undefined;
    friendId?: string | null;
    refCode: string | null | undefined;
    source: FriendAddCandidateSource;
  },
): Promise<void> {
  const refCode = input.refCode?.trim();
  if (!db || !input.lineAccountId || !input.lineUserId || !refCode || refCode.startsWith('xh:')) {
    return;
  }
  let record: typeof recordEntryRouteStopSuppression | undefined;
  try {
    record = recordEntryRouteStopSuppression;
  } catch {
    record = undefined;
  }
  if (typeof record !== 'function') return;
  // 一時的なDB障害で記録を落とすと、復旧後のfollowが抑止を失う。
  // 短い再試行で書き切る。恒久障害では握り潰さず投げて本線を止める
  // (fail-closed。呼び口の intent/link/callback は 500 になる)。
  // 記録なしの 404/410/200 を返すと、復旧後の再試行も起きず follow が
  // 自然流入扱いになるため。
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await record(db, {
        lineAccountId: input.lineAccountId,
        lineUserId: input.lineUserId,
        friendId: input.friendId ?? null,
        refCode,
        source: input.source,
      });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

// N-244差戻(台帳): 直近の停止試行があればその行、DB読取失敗なら
// 'unknown' (fail-closed で抑止側に倒すため)、どちらも無ければ null。
// 台帳が無いテスト用モックでは null (従来どおり通す側)。
export async function getActiveStopSuppressionSafe(
  db: D1Database,
  lineAccountId: string | null | undefined,
  lineUserId: string | null | undefined,
): Promise<EntryRouteStopSuppression | 'unknown' | null> {
  if (!db || !lineAccountId || !lineUserId) return null;
  let lookup: typeof getActiveEntryRouteStopSuppression | undefined;
  try {
    lookup = getActiveEntryRouteStopSuppression;
  } catch {
    lookup = undefined;
  }
  if (typeof lookup !== 'function') return null;
  try {
    return await lookup(db, { lineAccountId, lineUserId });
  } catch (err) {
    console.error('Stop suppression lookup failed (fail-closed):', err);
    return 'unknown';
  }
}

// 停止・不存在を区別せず返す同一の終了応答。ref の echo や内部状態・
// 転送先を含めない。/r/:ref と各入口の開始時で同じ文面・同じ 410 を使う。
export const ENTRY_ROUTE_STOPPED_HTML =
  '<!doctype html><html lang="ja"><meta charset="utf-8"><title>このページは利用できません</title><body><main><h1>このページは利用できません</h1><p>公開が終わっているか、アドレスが正しくありません。運用者へ、新しいリンクをご確認ください。</p></main></body></html>';
