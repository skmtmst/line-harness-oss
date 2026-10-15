import { getAccountSetting, jstNow } from '@line-crm/db';

import {
  FOLLOWER_IMPORT_STATE_KEY,
  getFollowerImportState,
  type FollowerImportClient,
  type FollowerImportState,
  type OwnershipGuard,
} from './follower-import-state.js';
import { hydrateProfilePage, importIdPage } from './follower-import-pages.js';

export {
  FOLLOWER_IMPORT_STATE_KEY,
  detectFollowerImportCapability,
  emptyFollowerImportState,
  getFollowerImportState,
  startFollowerImport,
} from './follower-import-state.js';
export type {
  FollowerImportCapability,
  FollowerImportClient,
  FollowerImportPhase,
  FollowerImportState,
  OwnershipGuard,
} from './follower-import-state.js';

// LINE のプロフィール取得は 1 人ずつしか引けない（まとめて引く API が無い）。
// 1 回の実行で引くプロフィールの上限。有料プランのサブリクエストは
// 1 invocation あたり 10,000 回までで、D1 の呼び出しもここに数えられる。
// 1 人 1 回の取得に加えてページ読み出しと書き戻しの分を空けて 9,000 人で切る。
const PROFILE_MAX_PER_RUN = 9_000;
// 1 回の実行に使う時間の既定値。画面から呼ばれたときの応答がこの長さになる。
// 使い切っても D1 のカーソルが残るので、続きは次の実行が引き継ぐ。
const DEFAULT_RUN_BUDGET_MS = 20_000;
// 時間予算に上乗せしてロックを押さえておく余白。
// 実行中に別の経路が同じアカウントへ入ってこないようにするための余白で、
// 予算を使い切った直後に解放されるよう短くしてある。
// 予算の超過はページの途中でも時間を見るので、走っている途中の
// プロフィール取得 1 本とそのページの書き戻しの分だけ。この余白で収まる。
const LOCK_MARGIN_MS = 30_000;

export interface FollowerImportStepResult {
  state: FollowerImportState;
  busy: boolean;
  /** この実行で読み出したプロフィールの人数。呼び出し側が残りの枠を引くのに使う。 */
  profilesFetched: number;
}

export interface FollowerImportStepOptions {
  /** この実行に使える時間。使い切ると途中で返し、続きは次の実行が引き継ぐ。 */
  budgetMs?: number;
  /** この実行で引けるプロフィールの上限。1 invocation のサブリクエスト枠を分け合うのに使う。 */
  maxProfiles?: number;
}

/**
 * Process as much as the given time/subrequest budget allows. State and cursors
 * live in D1, so closing the browser continues in the scheduled lane; requests
 * may also resume it under the same lock.
 */
export async function processFollowerImportStep(
  db: D1Database,
  client: FollowerImportClient,
  lineAccountId: string,
  options: FollowerImportStepOptions = {},
): Promise<FollowerImportStepResult> {
  let state = await getFollowerImportState(db, lineAccountId);
  if (state.phase === 'not_started' || state.phase === 'completed') {
    return { state, busy: false, profilesFetched: 0 };
  }

  const nowMs = Date.now();
  if (state.lockUntil && new Date(state.lockUntil).getTime() > nowMs) {
    return { state, busy: true, profilesFetched: 0 };
  }

  const budgetMs = Math.max(1_000, options.budgetMs ?? DEFAULT_RUN_BUDGET_MS);
  const maxProfiles = Math.max(1, options.maxProfiles ?? PROFILE_MAX_PER_RUN);
  const deadlineMs = nowMs + budgetMs;

  const lockToken = crypto.randomUUID();
  // ロックは時間予算より少しだけ長く押さえる。予算を使い切った直後に
  // 解放されるので、続きを次の実行がすぐ拾える。
  const lockUntil = new Date(deadlineMs + LOCK_MARGIN_MS).toISOString();
  const oldRaw = await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY);
  if (!oldRaw) return { state, busy: true, profilesFetched: 0 };
  const locked = { ...state, lockToken, lockUntil, updatedAt: jstNow() };
  const claim = await db.prepare(
    `UPDATE account_settings
        SET value = ?, updated_at = ?
      WHERE line_account_id = ? AND key = ? AND value = ?`,
  ).bind(
    JSON.stringify(locked), locked.updatedAt, lineAccountId,
    FOLLOWER_IMPORT_STATE_KEY, oldRaw,
  ).run();
  if ((claim.meta.changes ?? 0) === 0) return { state, busy: true, profilesFetched: 0 };
  state = locked;

  // 今 DB に入っている文字列を覚えておく。この実行の保存はすべて
  // 「自分が最後に書いた内容のまま」を条件にして書く。ロックの期限が
  // 切れたあとに別の実行が続きを引き継いでいた場合、ここが食い違うので
  // 書き込みは不成立になり、新しい進み具合を古い内容で巻き戻さない。
  let currentRaw = JSON.stringify(locked);
  let lockLost = false;

  const persist = async (): Promise<boolean> => {
    state.updatedAt = jstNow();
    const raw = JSON.stringify(state);
    const saved = await db.prepare(
      `UPDATE account_settings
          SET value = ?, updated_at = ?
        WHERE line_account_id = ? AND key = ? AND value = ?`,
    ).bind(
      raw, state.updatedAt, lineAccountId,
      FOLLOWER_IMPORT_STATE_KEY, currentRaw,
    ).run();
    if ((saved.meta.changes ?? 0) === 0) {
      lockLost = true;
      return false;
    }
    currentRaw = raw;
    return true;
  };

  // 友だち行への書き込みも同じ条件で守る。状態の保存だけを守っても、
  // 期限切れの旧実行が抱えている古いプロフィールが friends に入ってしまう。
  // currentRaw は保存のたびに進むので、条件の値は文を組むたびに読み直す。
  const guard: OwnershipGuard = {
    sql: `EXISTS (
            SELECT 1
              FROM account_settings
             WHERE line_account_id = ? AND key = ? AND value = ?
          )`,
    binds: () => [lineAccountId, FOLLOWER_IMPORT_STATE_KEY, currentRaw],
    stillOwned: async () => (
      await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY)
    ) === currentRaw,
  };

  let profilesFetched = 0;
  try {
    // 1 ページ終わるたびに予算を見て、残っていれば続けて次のページへ進む。
    // 以前は 1 回の実行で 1 ページだけ進めていたので、人数が多いと
    // 刻みの回数だけ待つことになっていた。
    while (state.phase === 'importing_ids' || state.phase === 'hydrating_profiles') {
      if (state.phase === 'importing_ids') {
        await importIdPage(db, client, lineAccountId, state, guard);
      } else {
        const page = await hydrateProfilePage(
          db, client, lineAccountId, state, maxProfiles - profilesFetched, deadlineMs, guard,
        );
        profilesFetched += page.attempted;
        // 書き戻しが交代後で成立しなかった。この実行は何も保存せず、
        // ロックも解除せずに降りる（解除すると引き継いだ側のロックを外す）。
        if (page.lockLost) {
          lockLost = true;
          break;
        }
        // 何も進まなかったページをもう一度引いても同じ結果になる。
        // D1 が落ちている・時間切れ・全員取得失敗のいずれかなので、
        // ここで切り上げて続きを次の実行へ渡す。
        if (!page.progressed) break;
      }
      // 1 ページ分の進み具合をここで保存する。最後の finally だけに任せると、
      // CPU 上限や立ち退きで実行が打ち切られたときに、DB には書けている
      // のに件数とカーソルが古いまま残る。ロックの項目はそのまま残すので
      // 他の実行は入ってこない。書き込みは 1 ページに 1 回だけ。
      // 書けなかったときは、ロックの期限切れで別の実行が続きを持っている。
      // 自分の手元の状態はもう古いので、何も書かずにここで降りる。
      if (!(await persist())) break;
      if (profilesFetched >= maxProfiles) break;
      if (Date.now() >= deadlineMs) break;
    }
    if (!lockLost) state.lastError = null;
  } catch (err) {
    state.lastError = '取り込みを再試行しています。しばらくして進み具合を確認してください。';
  } finally {
    // 続きを別の実行へ渡したあとに自分のロック解除を書くと、
    // 相手のロックまで外してしまう。持っているときだけ解放する。
    if (!lockLost) {
      state.lockToken = null;
      state.lockUntil = null;
      await persist();
    }
  }
  if (lockLost) {
    // 自分は追い抜かれた側。DB の最新を読み直して返す。
    const fresh = await getFollowerImportState(db, lineAccountId);
    return { state: fresh, busy: true, profilesFetched };
  }
  return { state, busy: false, profilesFetched };
}
