import {
  enrollFriendInScenario,
  jstNow,
  enqueueMileageEvent,
  getTagAddedScenarioIds,
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
  if (!added) return { added: false };

  try {
    await enqueueMileageEvent(db, {
      eventType: 'tag_added',
      source: 'tag',
      sourceEventId: `${friendId}:${tagId}:${assignedAt}`,
      friendId,
      subjectKey: tagId,
      metadata: { tagId },
      occurredAt: assignedAt,
    });
  } catch (error) {
    console.error('tag mileage enqueue failed:', error);
  }

  /*
   * 「このタグが付いたら始まる」は scenario_triggers から引く（128）。
   * 1本のシナリオを複数のタグから始められるようにしたため、
   * scenarios.trigger_tag_id は判断に使わない。
   */
  for (const scenarioId of await getTagAddedScenarioIds(db, tagId)) {
    const existing = await db
      .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
      .bind(friendId, scenarioId)
      .first();
    if (!existing) {
      const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
      if (push) {
        await pushImmediateFirstStep(db, friendId, scenarioId, push, { enrollment });
      }
    }
  }

  await fireEvent(db, 'tag_change', { friendId, eventData: { tagId, action: 'add' } });
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
