import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getFriendAddRoutingDraftVersion,
  listFriendAddEvents,
  publishFriendAddRoutingDraftVersion,
  recordFriendAddRoutingDraftTest,
  saveFriendAddRoutingDraftVersion,
  type FriendAddRoutingVersionRow,
} from '@line-crm/db';
import type {
  FriendAddKind,
  FriendAddAttributionStatus,
  FriendAddRoutingStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  loadFriendAddRouting,
  saveFriendAddRouting,
  normalizeRouting,
  previewFriendAddRouting,
  previewFriendAddRoutingDefinition,
  listFriendAddScenarios,
  classifyFriend,
} from '../services/friend-add-routing.js';
import {
  FRIEND_ADD_ROUTING_DEFAULT,
  type FriendAddRouting,
  type FriendAddRoutingValidation,
  type FriendAddRoutingVersion,
} from '@line-crm/shared';
import { getVisibleLineAccountScope } from '../services/account-access.js';

/**
 * 友だち追加時の配信の振り分け（設計 V2 4-6）。
 *
 * 置き場は `account_settings`。`feature-settings.ts` と同じ判断で、
 * 新しいテーブルは作っていない。
 */
const friendAddRouting = new Hono<Env>();

const EVENT_KINDS = new Set<FriendAddKind>(['first_time', 'returning']);
const ATTRIBUTION_STATUSES = new Set<FriendAddAttributionStatus>(['captured', 'unavailable']);
const ROUTING_STATUSES = new Set<FriendAddRoutingStatus>(['pending', 'completed', 'failed', 'suppressed']);

function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

async function canUseAccount(c: Context<Env>, accountId: string): Promise<boolean> {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.ids.includes(accountId);
}

function versionResponse(row: FriendAddRoutingVersionRow): FriendAddRoutingVersion {
  return {
    accountId: row.line_account_id,
    versionId: row.id,
    versionNumber: Number(row.version_number),
    status: row.status,
    routing: normalizeRouting(JSON.parse(row.definition_snapshot)),
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    publishedAt: row.published_at,
  };
}

async function getEstimatedAudienceCount(db: D1Database, accountId: string): Promise<number | null> {
  const audience = await db.prepare(
    `SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ? AND is_following = 1`,
  ).bind(accountId).first<{ count: number | null }>();
  const count = audience?.count;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

async function validateRoutingDraft(
  db: D1Database,
  accountId: string,
  row: FriendAddRoutingVersionRow,
): Promise<FriendAddRoutingValidation> {
  const routing = normalizeRouting(JSON.parse(row.definition_snapshot));
  const [scenarios, estimatedAudienceCount] = await Promise.all([
    listFriendAddScenarios(db, accountId),
    getEstimatedAudienceCount(db, accountId),
  ]);
  const allowed = new Set(scenarios.map((scenario) => scenario.id));
  const firstInvalid = Boolean(routing.firstTime.scenarioId && !allowed.has(routing.firstTime.scenarioId));
  const returningMissing = routing.returning.mode === 'other' && !routing.returning.scenarioId;
  const returningInvalid = Boolean(
    routing.returning.scenarioId && !allowed.has(routing.returning.scenarioId),
  );
  const actionCount = routing.firstTime.actions.length + routing.returning.actions.length;
  const canPublish = !firstInvalid && !returningMissing && !returningInvalid;

  return {
    canPublish,
    estimatedAudienceCount,
    checks: [
      {
        key: 'first_time',
        label: 'はじめて友だち追加した人への配信',
        status: firstInvalid ? 'failed' : routing.firstTime.scenarioId ? 'passed' : 'warning',
        detail: firstInvalid
          ? 'このLINEアカウントで使えないシナリオです。'
          : routing.firstTime.scenarioId
            ? '配信するシナリオを確認できました。'
            : '個別指定はありません。有効な友だち追加シナリオを使います。',
      },
      {
        key: 'returning',
        label: '以前からの友だち・ブロック解除後の配信',
        status: returningMissing || returningInvalid ? 'failed' : 'passed',
        detail: returningMissing
          ? '「別のシナリオ」を選んだため、配信するシナリオを決めてください。'
          : returningInvalid
            ? 'このLINEアカウントで使えないシナリオです。'
            : routing.returning.mode === 'none'
              ? '配信せず、設定したアクションだけを実行します。'
              : '配信方法を確認できました。',
      },
      {
        key: 'actions',
        label: '配信と一緒に行うこと',
        status: 'passed',
        detail: actionCount === 0
          ? '追加の操作はありません。'
          : `${actionCount}件の操作を、並べた順に実行します。`,
      },
      {
        key: 'duplicate_prevention',
        label: '同じ友だち追加通知の二重実行防止',
        status: 'passed',
        detail: 'LINEアカウントとWebhookイベントの組み合わせで、同じ通知を1回だけ処理します。',
      },
    ],
    // 初回／再追加は同じ判定器が必ずどちらか一方へ分類するため、
    // ルール同士が同時に勝つ競合は作られない。
    conflicts: [],
    lastTestStatus: row.last_test_status,
  };
}

function validIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && value.length >= 16 && value.length <= 200);
}

/** V6の履歴一覧。設定画面とは別に、共通Pencilデザインが直接使える形で返す。 */
friendAddRouting.get(
  '/api/friend-add-routing/events',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const rawKind = c.req.query('kind');
    const rawAttribution = c.req.query('attribution_status');
    const rawRouting = c.req.query('routing_status');
    if (rawKind && !EVENT_KINDS.has(rawKind as FriendAddKind)) {
      return c.json({ success: false, error: 'kind が正しくありません' }, 400);
    }
    if (rawAttribution && !ATTRIBUTION_STATUSES.has(rawAttribution as FriendAddAttributionStatus)) {
      return c.json({ success: false, error: 'attribution_status が正しくありません' }, 400);
    }
    if (rawRouting && !ROUTING_STATUSES.has(rawRouting as FriendAddRoutingStatus)) {
      return c.json({ success: false, error: 'routing_status が正しくありません' }, 400);
    }

    try {
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.ids.includes(accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const rawLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
      const data = await listFriendAddEvents(c.env.DB, {
        lineAccountId: accountId,
        limit: Number.isFinite(rawLimit) ? rawLimit : 50,
        cursor: c.req.query('cursor') || null,
        kind: rawKind as FriendAddKind | undefined,
        attributionStatus: rawAttribution as FriendAddAttributionStatus | undefined,
        routingStatus: rawRouting as FriendAddRoutingStatus | undefined,
      });
      return c.json({ success: true, data });
    } catch (err) {
      console.error('GET /api/friend-add-routing/events error:', err);
      return c.json({ success: false, error: '友だち追加履歴を取得できませんでした' }, 500);
    }
  },
);

/**
 * 画面1枚ぶんをまとめて返す。
 *
 * 設定・選べるシナリオ・選べるタグを1回で返す。画面が3回叩くと、
 * 途中で失敗したときに「シナリオ名だけ出ない」ような半端な状態になる。
 */
friendAddRouting.get('/api/friend-add-routing', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.ids.includes(accountId)) {
      return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
    }

    const saved = await loadFriendAddRouting(c.env.DB, accountId);
    const scenarios = await listFriendAddScenarios(c.env.DB, accountId);
    const tagRows = await c.env.DB
      .prepare(
        `SELECT id, name FROM tags
          WHERE line_account_id = ?${scope.canSeeUnassigned ? ' OR line_account_id IS NULL' : ''}
          ORDER BY name ASC`,
      )
      .bind(accountId)
      .all<{ id: string; name: string }>();
    const tags = tagRows.results ?? [];

    return c.json({
      success: true,
      data: {
        /** false のときは、いままでどおり friend_add シナリオを全部流している */
        configured: saved !== null,
        routing: saved ?? FRIEND_ADD_ROUTING_DEFAULT,
        scenarios,
        tags,
      },
    });
  } catch (err) {
    console.error('GET /api/friend-add-routing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAddRouting.put(
  '/api/friend-add-routing',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.ids.includes(accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }

      const body = await c.req.json<unknown>();
      const routing = normalizeRouting((body as { routing?: unknown })?.routing ?? body);

      // ②で「別のシナリオを配信する」を選んだのにシナリオが空だと、
      // 保存はできるのに何も届かない。ここで止める。
      if (routing.returning.mode === 'other' && !routing.returning.scenarioId) {
        return c.json(
          { success: false, error: '「別のシナリオを配信する」を選んだときは、配信するシナリオを決めてください' },
          400,
        );
      }

      // 選んだシナリオが本当にこのアカウントの friend_add シナリオか確かめる。
      // 他アカウントのIDを入れられると、別の店の配信が流れる。
      const allowed = new Set((await listFriendAddScenarios(c.env.DB, accountId)).map((s) => s.id));
      for (const id of [routing.firstTime.scenarioId, routing.returning.scenarioId]) {
        if (id && !allowed.has(id)) {
          return c.json(
            { success: false, error: 'このアカウントで使えないシナリオが指定されています' },
            400,
          );
        }
      }

      await saveFriendAddRouting(c.env.DB, accountId, routing);
      return c.json({ success: true, data: { routing } });
    } catch (err) {
      console.error('PUT /api/friend-add-routing error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

/** 下書きを読む。公開中の設定とは別なので、編集中に本番の配信は変わらない。 */
friendAddRouting.get(
  '/api/friend-add-routing/draft',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const draft = await getFriendAddRoutingDraftVersion(c.env.DB, accountId);
      if (!draft) return c.json({ success: false, error: '確認する下書きがありません' }, 404);
      return c.json({ success: true, data: versionResponse(draft) });
    } catch (err) {
      console.error('GET /api/friend-add-routing/draft error:', err);
      return c.json({ success: false, error: '下書きを読み込めませんでした' }, 500);
    }
  },
);

/** 下書きを保存する。保存するたびに試験結果を無効にし、古い試験で公開させない。 */
friendAddRouting.put(
  '/api/friend-add-routing/draft',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const body = await c.req.json<unknown>();
      const routing = normalizeRouting((body as { routing?: unknown })?.routing ?? body);
      const draft = await saveFriendAddRoutingDraftVersion(c.env.DB, accountId, routing);
      return c.json({ success: true, data: versionResponse(draft) });
    } catch (err) {
      console.error('PUT /api/friend-add-routing/draft error:', err);
      return c.json({ success: false, error: '下書きを保存できませんでした' }, 500);
    }
  },
);

friendAddRouting.post(
  '/api/friend-add-routing/validate',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const draft = await getFriendAddRoutingDraftVersion(c.env.DB, accountId);
      if (!draft) return c.json({ success: false, error: '公開する下書きがありません' }, 404);
      return c.json({ success: true, data: await validateRoutingDraft(c.env.DB, accountId, draft) });
    } catch (err) {
      console.error('POST /api/friend-add-routing/validate error:', err);
      return c.json({ success: false, error: '公開前の確認を実行できませんでした' }, 500);
    }
  },
);

friendAddRouting.get(
  '/api/friend-add-routing/conflicts',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const draft = await getFriendAddRoutingDraftVersion(c.env.DB, accountId);
      if (!draft) return c.json({ success: false, error: '確認する下書きがありません' }, 404);
      const validation = await validateRoutingDraft(c.env.DB, accountId, draft);
      return c.json({ success: true, data: { conflicts: validation.conflicts } });
    } catch (err) {
      console.error('GET /api/friend-add-routing/conflicts error:', err);
      return c.json({ success: false, error: '競合を確認できませんでした' }, 500);
    }
  },
);

/**
 * 下書きを本番と同じ分類器へ通すdry-run。
 * シナリオ登録・メッセージ送信・タグ付け・マイル付与は一切行わない。
 */
friendAddRouting.post(
  '/api/friend-add-routing/draft/test',
  requireRole('owner', 'admin'),
  async (c) => {
    let draft: FriendAddRoutingVersionRow | null = null;
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      draft = await getFriendAddRoutingDraftVersion(c.env.DB, accountId);
      if (!draft) return c.json({ success: false, error: '試す下書きがありません' }, 404);

      const body = await c.req.json<{ friendId?: string }>();
      if (!body.friendId) return c.json({ success: false, error: '試す友だちを選んでください' }, 400);
      const friend = await c.env.DB.prepare(
        `SELECT id, unfollow_count, first_followed_at, display_name
           FROM friends WHERE id = ? AND line_account_id = ?`,
      ).bind(body.friendId, accountId).first<{
        id: string;
        unfollow_count: number | null;
        first_followed_at: string | null;
        display_name: string | null;
      }>();
      if (!friend) return c.json({ success: false, error: '友だちが見つかりません' }, 404);

      const routing = normalizeRouting(JSON.parse(draft.definition_snapshot));
      const result = previewFriendAddRoutingDefinition(routing, friend);
      const scenarios = await listFriendAddScenarios(c.env.DB, accountId);
      const scenarioName = scenarios.find((item) => item.id === result.scenarioId)?.name ?? null;
      await recordFriendAddRoutingDraftTest(c.env.DB, draft.id, {
        succeeded: true,
        staffId: c.get('staff').id,
      });
      return c.json({
        success: true,
        data: {
          versionId: draft.id,
          displayName: friend.display_name,
          ...result,
          scenarioName,
          stateChanged: false as const,
        },
      });
    } catch (err) {
      if (draft) {
        await recordFriendAddRoutingDraftTest(c.env.DB, draft.id, {
          succeeded: false,
          staffId: c.get('staff').id,
        }).catch(() => undefined);
      }
      console.error('POST /api/friend-add-routing/draft/test error:', err);
      return c.json({ success: false, error: 'テストを実行できませんでした' }, 500);
    }
  },
);

friendAddRouting.post(
  '/api/friend-add-routing/publish',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
      if (!await canUseAccount(c, accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const idempotencyKey = c.req.header('Idempotency-Key');
      if (!validIdempotencyKey(idempotencyKey)) {
        return c.json({ success: false, error: '公開操作の識別キーが必要です' }, 400);
      }

      const draft = await getFriendAddRoutingDraftVersion(c.env.DB, accountId);
      if (draft) {
        const validation = await validateRoutingDraft(c.env.DB, accountId, draft);
        if (!validation.canPublish) {
          return c.json({
            success: false,
            error: '公開前に直す項目があります',
            data: validation,
          }, 409);
        }
        if (draft.last_test_status !== 'succeeded') {
          return c.json({ success: false, error: '下書きをテストしてから公開してください' }, 409);
        }
      }

      const published = await publishFriendAddRoutingDraftVersion(c.env.DB, accountId, {
        idempotencyKey,
        staffId: c.get('staff').id,
      });
      const estimatedAudienceCount = await getEstimatedAudienceCount(c.env.DB, accountId);
      if (!published.published_at) {
        throw new Error('FRIEND_ADD_ROUTING_PUBLISHED_AT_MISSING');
      }
      return c.json({
        success: true,
        data: {
          accountId,
          versionId: published.id,
          versionNumber: Number(published.version_number),
          publishedAt: published.published_at,
          estimatedAudienceCount,
          duplicatePrevention: 'webhook_event' as const,
          monitoringPath: null,
          monitoringUnavailableReason: '実行結果の画面はまだ接続されていません。',
        },
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'FRIEND_ADD_ROUTING_DRAFT_NOT_FOUND') {
        return c.json({ success: false, error: '公開する下書きがありません' }, 404);
      }
      if (code === 'FRIEND_ADD_ROUTING_DRAFT_NOT_TESTED') {
        return c.json({ success: false, error: '下書きをテストしてから公開してください' }, 409);
      }
      console.error('POST /api/friend-add-routing/publish error:', err);
      return c.json({ success: false, error: '友だち追加時の配信を公開できませんでした' }, 500);
    }
  },
);

/**
 * テスト実行。**登録も配信もしない。**
 *
 * 指定した友だちが、いまの設定でどちらに振り分けられるかだけを返す。
 * 設計の「テスト実行」がこれ。実際に送ってしまうと、確かめるたびに
 * お客さまへメッセージが飛ぶ。
 */
friendAddRouting.post(
  '/api/friend-add-routing/test',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.ids.includes(accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }

      const body = await c.req.json<{ friendId?: string }>();
      if (!body.friendId) return c.json({ success: false, error: 'friendId が必要です' }, 400);

      const friend = await c.env.DB.prepare(
        `SELECT id, unfollow_count, first_followed_at, display_name
           FROM friends WHERE id = ? AND line_account_id = ?`,
      )
        .bind(body.friendId, accountId)
        .first<{
          id: string;
          unfollow_count: number | null;
          first_followed_at: string | null;
          display_name: string | null;
        }>();
      if (!friend) return c.json({ success: false, error: '友だちが見つかりません' }, 404);

      const result = await previewFriendAddRouting(c.env.DB, accountId, friend);
      return c.json({
        success: true,
        data: {
          ...result,
          displayName: friend.display_name,
          unfollowCount: friend.unfollow_count ?? 0,
          firstFollowedAt: friend.first_followed_at,
        },
      });
    } catch (err) {
      console.error('POST /api/friend-add-routing/test error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

export { friendAddRouting, classifyFriend };
