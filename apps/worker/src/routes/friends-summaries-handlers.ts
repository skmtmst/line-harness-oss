import { serializeFriend } from './friend-display.js';
import { patchFriendMetadata } from '../features/friends/friend-metadata/index.js';
import { inputError } from '../lib/input-errors.js';
import { hydrateDocumentAnswers } from '../features/forms/form-documents/index.js';
import { getFriendSummary } from '@line-crm/db';
import { getFriendUpcomingItems } from '../features/friends/friend-upcoming-items/index.js';

import { getFriendById, getFriendWithFirstTrackedLinkName, addTagToFriend, getFriendTags, getFormSubmissionsByFriend, getFormSubmissionsByFriendCursor, countFriendFormSubmissions, enrollFriendInScenario, getMileageSummaryForFriend, getMileageHistoryForFriend, getMileageSelfInsights, getMileageConnectedAccountsForFriend, jstNow, getTagAddedScenarioIdsForAccount } from '@line-crm/db';
import type { Tag as DbTag } from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { resolveRequestBoundaries } from '../services/request-boundary.js';
import { listLimit } from './list-pagination.js';
import { serializeTag, serializeFriendFormSubmission } from './friends-definition.js';
import type { Context } from 'hono';

export const get__api_friends_id_mileage_1 = async (c: Context<Env, "/api/friends/:id/mileage">) => {
  try {
    const friendId = c.req.param('id');
    const friend = await getFriendById(c.env.DB, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const requestedAccountId = c.req.query('accountId')?.trim();
    const friendAccountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    if (requestedAccountId && friendAccountId !== requestedAccountId) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 10;
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const [summary, history, insights, connections] = await Promise.all([
      getMileageSummaryForFriend(c.env.DB, friendId),
      // R387: 残高は名寄せした本人で共通だが、理由・実行者・元イベントは
      // 担当者が見られるアカウントの分だけ返す。
      getMileageHistoryForFriend(c.env.DB, friendId, {
        limit,
        visibleAccountIds: accountScope.allowedAccountIds,
      }),
      getMileageSelfInsights(c.env.DB, friendId),
      getMileageConnectedAccountsForFriend(c.env.DB, friendId, accountScope.allowedAccountIds),
    ]);
    return c.json({ success: true, data: { summary, history, insights, connections } });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_id_upcoming_2 = async (c: Context<Env, "/api/friends/:id/upcoming">) => {
  try {
    const friendId = c.req.param('id');
    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const accountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    const nowIso = new Date().toISOString();

    type BookingCandidate = {
      kind: 'booking' | 'event_booking' | 'meet_consultation';
      id: string;
      title: string;
      startsAt: string;
      status: string;
    };

    const fetchNextBooking = async (): Promise<BookingCandidate | null> => {
      const candidates: BookingCandidate[] = [];
      if (accountId) {
        // 予約（店舗メニュー）。LINE未連携の予約客レコード経由も拾う。
        const booking = await db
          .prepare(
            `SELECT b.id, b.starts_at, b.status, m.name AS title
               FROM bookings b
               JOIN menus m ON m.id = b.menu_id
               LEFT JOIN booking_customers bc ON bc.id = b.booking_customer_id
              WHERE b.line_account_id = ?
                AND b.status IN ('requested', 'confirmed')
                AND b.starts_at > ?
                AND (b.friend_id = ? OR bc.friend_id = ?)
              ORDER BY b.starts_at ASC
              LIMIT 1`,
          )
          .bind(accountId, nowIso, friendId, friendId)
          .first<{ id: string; starts_at: string; status: string; title: string | null }>();
        if (booking) {
          candidates.push({
            kind: 'booking',
            id: booking.id,
            title: booking.title ?? '予約',
            startsAt: booking.starts_at,
            status: booking.status,
          });
        }
        // イベント予約。開催時刻は予約枠（event_slots）側にある。
        const eventBooking = await db
          .prepare(
            `SELECT eb.id, eb.status, es.starts_at, e.name AS title, e.id AS event_id
               FROM event_bookings eb
               JOIN event_slots es ON es.id = eb.slot_id
               JOIN events e ON e.id = eb.event_id
              WHERE eb.friend_id = ?
                AND eb.line_account_id = ?
                AND eb.status IN ('requested', 'confirmed')
                AND es.starts_at > ?
              ORDER BY es.starts_at ASC
              LIMIT 1`,
          )
          .bind(friendId, accountId, nowIso)
          .first<{ id: string; status: string; starts_at: string; title: string | null; event_id: string }>();
        if (eventBooking) {
          candidates.push({
            kind: 'event_booking',
            id: eventBooking.event_id,
            title: eventBooking.title ?? 'イベント',
            startsAt: eventBooking.starts_at,
            status: eventBooking.status,
          });
        }
      }
      // Google Meet 個別相談。アカウント列を持たないため友だちIDで引く。
      const meet = await db
        .prepare(
          `SELECT id, title, starts_at, status
             FROM meet_consultations
            WHERE friend_id = ?
              AND status = 'confirmed'
              AND starts_at > ?
            ORDER BY starts_at ASC
            LIMIT 1`,
        )
        .bind(friendId, nowIso)
        .first<{ id: string; title: string | null; starts_at: string; status: string }>();
      if (meet) {
        candidates.push({
          kind: 'meet_consultation',
          id: meet.id,
          title: meet.title ?? '個別相談',
          startsAt: meet.starts_at,
          status: meet.status,
        });
      }
      candidates.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
      return candidates[0] ?? null;
    };

    type AutoDeliveryCandidate = {
      kind: 'scenario' | 'reminder';
      id: string;
      name: string;
      scheduledAt: string;
    };

    const fetchNextAutoDelivery = async (): Promise<AutoDeliveryCandidate | null> => {
      const candidates: AutoDeliveryCandidate[] = [];
      // シナリオの確定済み次通。paused は止まっているので「確定」に入れない。
      const scenario = await db
        .prepare(
          `SELECT fs.scenario_id AS id, s.name, fs.next_delivery_at AS scheduled_at
             FROM friend_scenarios fs
             JOIN scenarios s ON s.id = fs.scenario_id
            WHERE fs.friend_id = ?
              AND fs.status IN ('active', 'delivering')
              AND fs.next_delivery_at IS NOT NULL
            ORDER BY fs.next_delivery_at ASC
            LIMIT 1`,
        )
        .bind(friendId)
        .first<{ id: string; name: string | null; scheduled_at: string }>();
      if (scenario) {
        candidates.push({
          kind: 'scenario',
          id: scenario.id,
          name: scenario.name ?? 'シナリオ',
          scheduledAt: scenario.scheduled_at,
        });
      }
      // リマインダの確定済み配信（queued=予定、claimed=送信中、retry_wait=再試行待ち）。
      const reminder = await db
        .prepare(
          `SELECT rr.reminder_id AS id, r.name, rr.scheduled_at
             FROM reminder_delivery_runs rr
             JOIN reminders r ON r.id = rr.reminder_id
            WHERE rr.friend_id = ?
              AND rr.status IN ('queued', 'claimed', 'retry_wait')
            ORDER BY rr.scheduled_at ASC
            LIMIT 1`,
        )
        .bind(friendId)
        .first<{ id: string; name: string | null; scheduled_at: string }>();
      if (reminder) {
        candidates.push({
          kind: 'reminder',
          id: reminder.id,
          name: reminder.name ?? 'リマインダ',
          scheduledAt: reminder.scheduled_at,
        });
      }
      candidates.sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0));
      return candidates[0] ?? null;
    };

    const [bookingResult, autoDeliveryResult, itemsResult] = await Promise.allSettled([
      fetchNextBooking(),
      fetchNextAutoDelivery(),
      getFriendUpcomingItems(db, friendId, accountId, nowIso),
    ]);

    return c.json({
      success: true,
      data: {
        items: itemsResult.status === 'fulfilled' ? itemsResult.value : [],
        itemsError: itemsResult.status === 'rejected',
        nextBooking: bookingResult.status === 'fulfilled' ? bookingResult.value : null,
        nextBookingError: bookingResult.status === 'rejected',
        nextAutoDelivery: autoDeliveryResult.status === 'fulfilled' ? autoDeliveryResult.value : null,
        nextAutoDeliveryError: autoDeliveryResult.status === 'rejected',
      },
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_stats_3 = async (c: Context<Env, "/api/friends/stats">) => {
  try {
    const { getFriendStats } = await import('@line-crm/db');
    const accountId = c.req.query('accountId') ?? null;
    if (accountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const statsScope = accountId
      ? { allowedAccountIds: [accountId], includeUnassigned: false }
      : await getVisibleLineAccountScope(c.env.DB, c.get('staff')).then((scope) => ({
          allowedAccountIds: scope.allowedAccountIds,
          includeUnassigned: scope.canSeeUnassigned,
        }));
    const stats = await getFriendStats(c.env.DB, statsScope);
    return c.json({ success: true as const, data: stats });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_id_summary_4 = async (c: Context<Env, "/api/friends/:id/summary">) => {
  try {
    const friend = await getFriendById(c.env.DB, c.req.param('id'));
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    const data = await getFriendSummary(c.env.DB, friend.id, friend.line_account_id ?? null);
    return c.json({ success: true, data });
  } catch (error) {
    throw error;
  }
};

export const get__api_friends_id_5 = async (c: Context<Env, "/api/friends/:id">) => {
  try {
    const id = c.req.param('id');
    const db = c.env.DB;
    /*
     * PERF-13: `?submissions=0` で回答本文の同梱を止める。
     * 回答は forms タブを開いたとき /api/friends/:id/form-submissions で
     * カーソル式に取る。「あと何件あるか」の総数は軽いので常に返す。
     */
    const includeSubmissions = c.req.query('submissions') !== '0';

    const [friend, tags, formSubmissions, formSubmissionTotal, support] = await Promise.all([
      // 一覧と同じ first_tracked_link_id → tracked_links.name 基準で
      // 流入元名を添える（N-036）。無い・消えた流入元は null で、
      // 画面側は従来どおり「不明」を出す。
      getFriendWithFirstTrackedLinkName(db, id),
      getFriendTags(db, id),
      /*
       * 回答は最新10件まで。「あと何件あるか」が分かるよう、総数を
       * 別に数えて返す（INBOX-17）。画面側は「全N件中10件を表示」と
       * 続きへの導線を出せる。
       */
      includeSubmissions ? getFormSubmissionsByFriend(db, id, 10) : Promise.resolve([]),
      countFriendFormSubmissions(db, id).catch(() => null),
      /*
       * 対応の状況（対応マーク・担当者・メモ）。
       *
       * 詳細画面はこれを出す設計だが、これまで返していなかったので
       * 「受信箱で扱っています」という案内文しか置けなかった。同じ人の
       * 話を2画面に分けて見に行くことになる。
       *
       * chats に行が無い友だちもいる（一度も受信していない）。その場合は
       * 未対応でも対応済みでもなく「やり取りがまだ無い」なので null を返し、
       * 画面側で出し分ける。
       */
      db
        .prepare(
          `SELECT c.status, c.notes, o.name AS operator_name
             FROM chats c
             LEFT JOIN operators o ON o.id = c.operator_id
            WHERE c.friend_id = ?
            LIMIT 1`,
        )
        .bind(id)
        .first<{ status: string; notes: string | null; operator_name: string | null }>()
        .catch(() => null),
    ]);

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...serializeFriend(friend),
        firstTrackedLinkName: friend.first_tracked_link_name ?? null,
        tags: tags.map(serializeTag),
        support: support
          ? {
              status: support.status,
              operatorName: support.operator_name,
              notes: support.notes,
            }
          : null,
        formSubmissionTotal,
        formSubmissions: formSubmissions.map(serializeFriendFormSubmission),
      },
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_id_form_submissions_6 = async (c: Context<Env, "/api/friends/:id/form-submissions">) => {
  try {
    const id = c.req.param('id');
    const limit = listLimit(c.req.query('limit'), 10, 50);
    const cursor = c.req.query('cursor') || null;
    const [page, total] = await Promise.all([
      getFormSubmissionsByFriendCursor(c.env.DB, id, { limit, cursor }),
      countFriendFormSubmissions(c.env.DB, id).catch(() => null),
    ]);
    return c.json({
      success: true,
      data: {
        items: await Promise.all(page.items.map(async row => { const item = serializeFriendFormSubmission(row); return { ...item, data: await hydrateDocumentAnswers(c.env.DB, item.data, c.get('staff')?.role, row.id) }; })),
        total,
        nextCursor: page.nextCursor,
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_friends_id_tags_7 = async (c: Context<Env, "/api/friends/:id/tags">) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ tagId: string }>();

    if (!body.tagId) {
      return inputError(c, { success: false, error: 'tagId is required' }, 400, ["tagId"]);
    }

    const db = c.env.DB;
    const tag = await db.prepare(
      'SELECT id, line_account_id, manual_assignment_allowed FROM tags WHERE id = ?',
    ).bind(body.tagId).first<Pick<DbTag, 'id' | 'line_account_id' | 'manual_assignment_allowed'>>();
    if (!tag) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const friendAccountId = ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    const tagAccountId = tag.line_account_id ?? null;
    // N-041/N-044(#803): friends行とtags行の所属をDBから解決し、共通境界へ渡す。
    const boundary = await resolveRequestBoundaries(db, c.get('staff'), [friendAccountId, tagAccountId]);
    if (!boundary.allowed) {
      if (boundary.reason === 'unauthenticated') {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }
      if (boundary.reason === 'forbidden') {
        return c.json({ success: false, error: 'Forbidden' }, 403);
      }
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    // 別所属の組合せは存在を漏らさず拒否する。所属なしタグ(共通)は従来どおり付けられる。
    if (tagAccountId !== null && tagAccountId !== friendAccountId) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    // 手動付与禁止のタグは付けられない。
    if (Number(tag.manual_assignment_allowed ?? 1) !== 1 || await db.prepare('SELECT id FROM member_rank_tiers WHERE tag_id=?').bind(body.tagId).first()) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }

    await addTagToFriend(db, friendId, body.tagId);

    // Enroll in tag_added scenarios that match this tag
    /*
     * 「このタグが付いたら始まる」は scenario_triggers から引く（128）。
     * 1本のシナリオが複数のタグで始まる形も作れるようになったので、
     * scenarios.trigger_tag_id は判断に使わない。
     * 友だちと同じアカウントの公開済みだけを始める（R435）。
     * 共通タグをきっかけにした別組織のシナリオは混ぜない。
     */
    for (const scenarioId of await getTagAddedScenarioIdsForAccount(db, body.tagId, friendAccountId)) {
      const existing = await db
        .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
        .bind(friendId, scenarioId)
        .first();
      if (!existing) {
        await enrollFriendInScenario(db, friendId, scenarioId);
      }
    }

    // イベントバス発火: tag_change（R436）。
    // 手動操作は毎クリックで発火する合図なので、重複付与でも発火は保つ。
    // 公開版が受け取れるよう、発生元の不変IDと所属を付ける。
    // IDは「手動の付与:友だち:タグ:確定時刻」で、台帳の値なので安定する。
    const assignedRow = await db
      .prepare(`SELECT assigned_at FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
      .bind(friendId, body.tagId)
      .first<{ assigned_at: string | null }>();
    const assignedAt = assignedRow?.assigned_at ?? jstNow();
    const occurredAt = /[+-]\d{2}:?\d{2}$|Z$/.test(assignedAt) ? assignedAt : `${assignedAt}+09:00`;
    await fireEvent(db, 'tag_change', {
      sourceEventId: `manual_tag:${friendId}:${body.tagId}:${assignedAt}`,
      sourceKind: 'manual',
      occurredAt,
      friendId,
      eventData: { tagId: body.tagId, action: 'add' },
    }, undefined, friendAccountId);

    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    throw err;
  }
};

export const delete__api_friends_id_tags_tagId_8 = async (c: Context<Env, "/api/friends/:id/tags/:tagId">) => {
  try {
    const friendId = c.req.param('id');
    const tagId = c.req.param('tagId');

    if(await c.env.DB.prepare('SELECT id FROM member_rank_tiers WHERE tag_id=?').bind(tagId).first())return c.json({success:false,error:'rank_tag_managed'},403);
    const removed = await c.env.DB.prepare('DELETE FROM friend_tags WHERE friend_id=? AND tag_id=?').bind(friendId,tagId).run();
    if (!removed.meta.changes) return c.json({ success: true, data: null });

    // イベントバス発火: tag_change
    const friend = await getFriendById(c.env.DB, friendId);
    await fireEvent(c.env.DB, 'tag_change', { friendId, sourceEventId: `manual_tag_remove:${crypto.randomUUID()}`, sourceKind: 'manual', occurredAt: new Date().toISOString(), eventData: { tagId, action: 'remove' } }, undefined, friend?.line_account_id);

    return c.json({ success: true, data: null });
  } catch (err) {
    throw err;
  }
};

export const put__api_friends_id_metadata_9 = async (c: Context<Env, "/api/friends/:id/metadata">) => {
  try {
    const friendId = c.req.param('id');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const merged = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (value === null) delete merged[key];
      else if (typeof value === 'string') merged[key] = value;
      else return inputError(c, { success: false, error: 'metadata values must be string or null' }, 400, ["value"]);
    }
    const now = jstNow();

    // N-040(#808): 改訂値付きの更新は1回の条件付きUPDATEで突合する。
    // 指定なしは従来どおり無条件更新（既存互換）。
    const expectedUpdatedAt = c.req.query('expectedUpdatedAt')?.trim() || null;
    if (expectedUpdatedAt) {
      const applied = await patchFriendMetadata(db, friendId, body, { deleteNull: true, expectedUpdatedAt });
      if (!applied) {
        const current = await getFriendById(db, friendId);
        if (!current) {
          return c.json({ success: false, error: 'Friend not found' }, 404);
        }
        return c.json({
          success: false,
          code: 'METADATA_CONFLICT',
          error: 'ほかの変更が先に保存されました。最新の状態を読み直して、もう一度お試しください',
          currentUpdatedAt: (current as unknown as Record<string, unknown>).updated_at ?? null,
        }, 409);
      }
    } else {
      await patchFriendMetadata(db, friendId, body, { deleteNull: true });
    }

    const updated = await getFriendById(db, friendId);
    const tags = await getFriendTags(db, friendId);

    return c.json({
      success: true,
      data: {
        ...serializeFriend(updated!),
        tags: tags.map(serializeTag),
      },
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_id_messages_10 = async (c: Context<Env, "/api/friends/:id/messages">) => {
  try {
    const friendId = c.req.param('id');
    // Fetch the latest 200 messages (DESC) then reverse to ASC for display.
    // Using ORDER BY ASC LIMIT 200 returns the OLDEST 200 rows, which silently
    // hides recent activity for chatty friends. Exclude delivery_type='test'
    // to stay consistent with /api/chats/:id, so the same friend shows the
    // same history across DirectMessagePanel and the chat panel.
    const result = await c.env.DB
      .prepare(
        `SELECT id, direction, message_type as messageType, content, created_at as createdAt
         FROM messages_log WHERE friend_id = ?
           AND (delivery_type IS NULL OR delivery_type != 'test')
         ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(friendId)
      .all<{ id: string; direction: string; messageType: string; content: string; createdAt: string }>();
    return c.json({ success: true, data: result.results.reverse() });
  } catch (err) {
    throw err;
  }
};
