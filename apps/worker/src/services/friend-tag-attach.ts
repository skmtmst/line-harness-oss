import {
  enrollFriendInScenario,
  jstNow,
  enqueueMileageEvent,
  getTagAddedScenarioIds,
  FRIEND_TAG_SIDE_EFFECT_STEPS,
  isFriendTagSideEffectRetryable,
  listUnfinishedFriendTagSideEffectRuns,
  markFriendTagSideEffectCompleted,
  markFriendTagSideEffectFailed,
  markFriendTagSideEffectRunning,
  openFriendTagSideEffectRuns,
  type FriendTagSideEffectStep,
} from '@line-crm/db';
import { fireEvent } from './event-bus.js';
import { pushImmediateFirstStep, type ImmediatePushContext } from './immediate-first-step.js';

// friend に tag を attach し、`POST /api/friends/:id/tags` と同じ side effects を発火する。
// side effects: tag_added シナリオ enrollment + tag_change イベント (automation/webhook/scoring 用)。
//
// 新規付与のときだけ side effects を発火する (`changes` を見る)。同じ friend に同じ tag を
// 自動付与で繰り返し叩いたとき、シナリオの重複 enrollment や tag_change の重複発火を防ぐ。
//
// POST /api/friends/:id/tags は手動操作の signal として「毎クリックで発火」する設計のため、
// この helper には合流させていない (重複 enroll はチェックがあるが tag_change は冪等でない)。
// 自動経路 (予約 auto-tag 等) はここ経由で呼ぶ。
// `push` (optional): when supplied, a tag_added scenario whose first step is
// delay-0 gets that step pushed IMMEDIATELY after enrollment instead of
// waiting for the delivery cron — welcome messages should land the moment
// the user arrives. Callers without a push context keep cron delivery.
//
// #699: 付与は INSERT OR IGNORE で先に確定するため、そのあとの副作用が落ちると
// 次回この経路へ来ても changes=0 で早期 return し、落ちた副作用は二度と走らな
// かった。工程別の台帳 (friend_tag_side_effect_runs / migration 376) に
// 「付与は済んだが未了」を残し、次にこの経路へ来たときに未了の工程だけを
// 走り直す。台帳の設計と状態の意味は migration 376 に書いてある。

/** 工程1本の中身。走り直しでも同じ本体を、同じ assignedAt で呼ぶ。 */
interface StepDefinition {
  run(
    db: D1Database,
    friendId: string,
    tagId: string,
    assignedAt: string,
    push?: ImmediatePushContext,
  ): Promise<void>;
  /**
   * 新規付与の1回目で落ちたとき、呼び出し口まで例外を投げ直すか。
   *
   * マイルは元から `.catch` で握って先へ進めていたので、その扱いを保つ
   * (台帳には failed として残るので、握り潰しにはならない)。
   */
  propagatesFailure: boolean;
}

const STEP_DEFINITIONS: Record<FriendTagSideEffectStep, StepDefinition> = {
  mileage: {
    propagatesFailure: false,
    async run(db, friendId, tagId, assignedAt) {
      await enqueueMileageEvent(db, {
        eventType: 'tag_added',
        source: 'tag',
        // 冪等キーに付与時刻が入る。走り直しでは台帳の assigned_at を渡すので
        // 同じキーになり、同じ出来事が二重に積まれない。
        sourceEventId: `${friendId}:${tagId}:${assignedAt}`,
        friendId,
        subjectKey: tagId,
        metadata: { tagId },
        occurredAt: assignedAt,
      });
    },
  },

  /*
   * 「このタグが付いたら始まる」は scenario_triggers から引く（128）。
   * 1本のシナリオを複数のタグから始められるようにしたため、
   * scenarios.trigger_tag_id は判断に使わない。
   */
  scenario_enroll: {
    propagatesFailure: true,
    async run(db, friendId, tagId, _assignedAt, push) {
      for (const scenarioId of await getTagAddedScenarioIds(db, tagId)) {
        const existing = await db
          .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
          .bind(friendId, scenarioId)
          .first();
        // 既に登録済みのシナリオは飛ばす。途中で落ちた一巡を走り直しても、
        // 済んだ分は増えない。ここと部分UNIQUE索引が二重登録を防ぐ。
        if (!existing) {
          const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
          if (push) {
            await pushImmediateFirstStep(db, friendId, scenarioId, push, { enrollment });
          }
        }
      }
    },
  },

  event_tag_change: {
    propagatesFailure: true,
    async run(db, friendId, tagId) {
      await fireEvent(db, 'tag_change', { friendId, eventData: { tagId, action: 'add' } });
    },
  },
};

/** 台帳への書き込みは本題を巻き添えにしない。落ちても記録だけ残して先へ進む。 */
async function recordLedger(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error(`tag side effect ledger write failed (${what}):`, error);
  }
}

/**
 * 工程を1本走らせ、結果を台帳へ書く。落ちた場合はその error を返す。
 *
 * 走る前に running を立てるので、処理ごと消えて結末が分からなくなった行は
 * running のまま残る。冪等でない tag_change をそこから走り直さないための印。
 */
async function runStep(
  db: D1Database,
  friendId: string,
  tagId: string,
  step: FriendTagSideEffectStep,
  assignedAt: string,
  push?: ImmediatePushContext,
): Promise<unknown | null> {
  await recordLedger(step, () => markFriendTagSideEffectRunning(db, friendId, tagId, step));
  try {
    await STEP_DEFINITIONS[step].run(db, friendId, tagId, assignedAt, push);
  } catch (error) {
    console.error(
      `tag side effect failed (step=${step} friend=${friendId} tag=${tagId}):`,
      error,
    );
    await recordLedger(step, () =>
      markFriendTagSideEffectFailed(db, friendId, tagId, step, error),
    );
    return error;
  }
  await recordLedger(step, () => markFriendTagSideEffectCompleted(db, friendId, tagId, step));
  return null;
}

export interface FriendTagSideEffectRetryResult {
  /** 走り直した工程の数。 */
  retried: number;
  /** そのうち、また落ちた工程の数。 */
  failed: number;
}

/**
 * この (友だち, タグ) で未了のまま残っている工程だけを走り直す。
 *
 * 呼び口はふたつ。
 *  - 同じ経路へもう一度来たとき (attachTagAndFireSideEffects の changes=0 側)
 *  - 未了の行を listPendingFriendTagSideEffectRuns で拾った掃除口
 *
 * ここは**例外を投げない**。走り直しは、たまたま通りかかった別の呼び出しに
 * 相乗りして行う後始末であり、失敗させて呼び出し口の本題を巻き添えにしない。
 * 失敗は台帳の failed と console.error に残る。
 */
export async function retryFriendTagSideEffects(
  db: D1Database,
  friendId: string,
  tagId: string,
  push?: ImmediatePushContext,
): Promise<FriendTagSideEffectRetryResult> {
  let unfinished;
  try {
    unfinished = await listUnfinishedFriendTagSideEffectRuns(db, friendId, tagId);
  } catch (error) {
    console.error('tag side effect ledger read failed:', error);
    return { retried: 0, failed: 0 };
  }

  const result: FriendTagSideEffectRetryResult = { retried: 0, failed: 0 };
  for (const run of unfinished) {
    // 走り直してよい行だけ。上限を超えた行と、結末が分からない冪等でない行は
    // 台帳に残したまま触らない (二重に外へ出さない)。
    if (!isFriendTagSideEffectRetryable(run)) continue;
    result.retried += 1;
    // 冪等キーは付与のときの時刻でなければならない。台帳の assigned_at を使う。
    if ((await runStep(db, friendId, tagId, run.step_key, run.assigned_at, push)) !== null) {
      result.failed += 1;
    }
  }
  return result;
}

export async function attachTagAndFireSideEffects(
  db: D1Database,
  friendId: string,
  tagId: string,
  push?: ImmediatePushContext,
): Promise<{ added: boolean }> {
  const assignedAt = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, assignedAt)
    .run();
  const added = (result.meta?.changes ?? 0) > 0;

  if (!added) {
    // 付与は前に済んでいる。前回落ちたままの工程があれば、それだけ走り直す。
    // 台帳に未了が無ければ何も走らないので、従来どおり静かに戻る。
    await retryFriendTagSideEffects(db, friendId, tagId, push);
    return { added: false };
  }

  // 副作用を1本も走らせる前に、工程を3本まとめて開く。1本目で落ちても
  // 「何が未了か」が残る。台帳が書けなかった場合でも副作用は従来どおり
  // 走らせる — ここで止めると付与だけが残り、以前より悪くなる。
  await recordLedger('open', () =>
    openFriendTagSideEffectRuns(db, { friendId, tagId, assignedAt }),
  );

  // 1本落ちても残りは走らせる。工程どうしは独立していて、シナリオ登録が
  // 落ちたことを理由に tag_change まで止める必要はない。
  let propagated: unknown | null = null;
  for (const step of FRIEND_TAG_SIDE_EFFECT_STEPS) {
    const error = await runStep(db, friendId, tagId, step, assignedAt, push);
    if (error !== null && STEP_DEFINITIONS[step].propagatesFailure && propagated === null) {
      propagated = error;
    }
  }
  // 従来どおり、シナリオ登録と tag_change の失敗は呼び出し口へ知らせる。
  if (propagated !== null) throw propagated;

  return { added: true };
}

// 自動判定から外れたタグを解除し、付与時と同じく automation / webhook / scoring に
// 状態変化を知らせる。DELETE の changes を見ることで再同期を冪等に保つ。
export async function detachTagAndFireSideEffects(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<{ removed: boolean }> {
  const result = await db
    .prepare(`DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
    .bind(friendId, tagId)
    .run();
  const removed = (result.meta?.changes ?? 0) > 0;
  if (!removed) return { removed: false };

  await fireEvent(db, 'tag_change', { friendId, eventData: { tagId, action: 'remove' } });
  return { removed: true };
}
