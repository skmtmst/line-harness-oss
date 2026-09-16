import { Hono, type Context } from 'hono';
import {
  NenRankValidationError,
  countNenMilestoneReached,
  ensureNenRankDefaults,
  findOrCreateGlobalTag,
  getNenLifetimeMilestones,
  getNenMemberKpis,
  getNenRankRules,
  getNenRankSettings,
  jstNow,
  listNenMembers,
  resolveRank,
  saveNenLifetimeMilestones,
  saveNenRankSettings,
  setNenRankSyncStatus,
  setNenRankTagId,
  type NenMemberListOptions,
  type NenRankSetting,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { NenRankSyncError, buildNenRankSyncPayload, pushNenRankSettingsToEc } from '../services/nen-rank-sync.js';
import { refreshAllNenTags } from '../services/nen-tag-sync.js';

/**
 * 然-NEN- 会員（ランク・ライフタイム・マイル）。★V6 37-1（`IqL2Z`）／37-1-A（`p7xHl`）／37-1-B（`Vt65m`）。
 *
 * - 設定の正本はここ（LINE管理画面）。保存すると版が上がり、ECへ署名付きで送る。
 * - 計算はEC側。結果は `POST /api/integrations/eccube/events` の `membership` で届く。
 * - 保存のたびに友だち属性タグ「[会員] ランク：◯◯」を用意し、見える範囲の友だちを付け替える。
 */
const nenRanks = new Hono<Env>();

function accountIdFrom(c: Context<Env>, body?: Record<string, unknown> | null): string {
  const fromBody = body && typeof body.accountId === 'string' ? body.accountId : '';
  const fromQuery = c.req.query('accountId') ?? '';
  return (fromBody || fromQuery).trim();
}

async function requireAccount(c: Context<Env>, accountId: string): Promise<Response | null> {
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  return null;
}

function serializeRank(rank: NenRankSetting, tagName: string | null, count: number) {
  return {
    id: rank.id,
    key: rank.rank_key,
    name: rank.name,
    annualThresholdYen: rank.annual_threshold_yen,
    mileRatePercent: rank.mile_rate_percent,
    tagId: rank.tag_id,
    tagName,
    memberCount: count,
  };
}

async function tagNames(db: D1Database, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db.prepare(
    `SELECT id, name FROM tags WHERE id IN (${unique.map(() => '?').join(',')})`,
  ).bind(...unique).all<{ id: string; name: string }>();
  return new Map(rows.results.map((row) => [row.id, row.name]));
}

/**
 * ランクに友だち属性タグを用意する。無ければ「[会員] ランク：◯◯」を作る。
 * 初期の4ランクは migration 080 のタグ ID を指しているが、そのタグが無い環境（新しい統括）では作り直す。
 */
async function ensureRankTags(db: D1Database, ranks: NenRankSetting[], now: string): Promise<NenRankSetting[]> {
  const existing = await tagNames(db, ranks.map((rank) => rank.tag_id));
  const result: NenRankSetting[] = [];
  for (const rank of ranks) {
    if (rank.tag_id && existing.has(rank.tag_id)) {
      result.push(rank);
      continue;
    }
    const tag = await findOrCreateGlobalTag(db, { name: `[会員] ランク：${rank.name}`, color: '#10B981' });
    await setNenRankTagId(db, rank.id, tag.id, now);
    result.push({ ...rank, tag_id: tag.id });
  }
  return result;
}

async function syncToEc(c: Context<Env>, accountId: string): Promise<{ status: 'synced' | 'failed' | 'skipped'; error: string | null }> {
  const db = c.env.DB;
  const [ranks, rules, milestones] = await Promise.all([
    getNenRankSettings(db, accountId),
    getNenRankRules(db, accountId),
    getNenLifetimeMilestones(db, accountId),
  ]);
  if (!rules) return { status: 'skipped', error: null };
  const baseUrl = c.env.NEN_EC_BASE_URL;
  const secret = c.env.ECCUBE_WEBHOOK_SECRET;
  if (!baseUrl || !secret) {
    const error = 'ECのつなぎ先（NEN_EC_BASE_URL / ECCUBE_WEBHOOK_SECRET）が未設定です';
    await setNenRankSyncStatus(db, accountId, 'failed', error);
    return { status: 'failed', error };
  }
  try {
    await pushNenRankSettingsToEc(baseUrl, secret, buildNenRankSyncPayload(ranks, rules, milestones));
    await setNenRankSyncStatus(db, accountId, 'synced', null);
    return { status: 'synced', error: null };
  } catch (error) {
    const message = error instanceof NenRankSyncError ? error.message : 'ECへの同期に失敗しました';
    await setNenRankSyncStatus(db, accountId, 'failed', message);
    return { status: 'failed', error: message };
  }
}

async function settingsResponse(c: Context<Env>, accountId: string) {
  const db = c.env.DB;
  await ensureNenRankDefaults(db, accountId);
  const [ranks, rules, milestones, kpis] = await Promise.all([
    getNenRankSettings(db, accountId).then((rows) => ensureRankTags(db, rows, jstNow())),
    getNenRankRules(db, accountId),
    getNenLifetimeMilestones(db, accountId),
    getNenMemberKpis(db, [accountId]),
  ]);
  const names = await tagNames(db, ranks.map((rank) => rank.tag_id));
  const reached = await countNenMilestoneReached(db, [accountId], milestones.map((m) => m.threshold_yen));
  return {
    ranks: ranks.map((rank) => serializeRank(rank, rank.tag_id ? names.get(rank.tag_id) ?? null : null, kpis.byRank[rank.rank_key] ?? 0)),
    rules: rules ? {
      yearStartMonth: rules.year_start_month,
      applyOnReach: rules.apply_on_reach,
      keepUntil: rules.keep_until,
      countOrders: rules.count_orders,
      version: rules.version,
      syncStatus: rules.sync_status,
      syncError: rules.sync_error,
      syncedAt: rules.synced_at,
      updatedAt: rules.updated_at,
    } : null,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      thresholdYen: milestone.threshold_yen,
      title: milestone.title,
      benefitKind: milestone.benefit_kind,
      benefitNote: milestone.benefit_note,
      notifyOnReach: milestone.notify_on_reach === 1,
      reachedCount: reached[milestone.threshold_yen] ?? 0,
    })),
    kpis,
  };
}

nenRanks.get('/api/nen/rank-settings', async (c) => {
  const accountId = accountIdFrom(c);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  return c.json({ success: true, data: await settingsResponse(c, accountId) });
});

type RankBody = { accountId?: string; ranks?: Array<{ id?: string | null; name?: unknown; annualThresholdYen?: unknown; mileRatePercent?: unknown }> };

nenRanks.put('/api/nen/rank-settings', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<RankBody>().catch(() => null);
  const accountId = accountIdFrom(c, body);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  if (!body || !Array.isArray(body.ranks)) return c.json({ success: false, error: 'ranks is required' }, 400);
  const now = jstNow();
  try {
    await ensureNenRankDefaults(c.env.DB, accountId, now);
    const saved = await saveNenRankSettings(c.env.DB, accountId, body.ranks.map((rank) => ({
      id: typeof rank.id === 'string' ? rank.id : null,
      name: String(rank.name ?? ''),
      annualThresholdYen: Number(rank.annualThresholdYen),
      mileRatePercent: Number(rank.mileRatePercent),
    })), now);
    await ensureRankTags(c.env.DB, saved, now);
  } catch (error) {
    if (error instanceof NenRankValidationError) return c.json({ success: false, error: error.message }, 400);
    throw error;
  }
  const sync = await syncToEc(c, accountId);
  // 付け替えは見える範囲の友だちだけ。ここで待つと保存が遅くなるので、上限を切って先頭だけ回し、残りは定期処理に任せる。
  const refreshed = await refreshAllNenTags(c.env.DB, [accountId], 200).catch(() => ({ friends: 0, added: 0, removed: 0 }));
  return c.json({ success: true, data: { ...(await settingsResponse(c, accountId)), sync, refreshed } });
});

type MilestoneBody = { accountId?: string; milestones?: Array<{ id?: string | null; thresholdYen?: unknown; title?: unknown; notifyOnReach?: unknown }> };

nenRanks.put('/api/nen/lifetime-milestones', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<MilestoneBody>().catch(() => null);
  const accountId = accountIdFrom(c, body);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  if (!body || !Array.isArray(body.milestones)) return c.json({ success: false, error: 'milestones is required' }, 400);
  const now = jstNow();
  try {
    await ensureNenRankDefaults(c.env.DB, accountId, now);
    await saveNenLifetimeMilestones(c.env.DB, accountId, body.milestones.map((milestone) => ({
      id: typeof milestone.id === 'string' ? milestone.id : null,
      thresholdYen: Number(milestone.thresholdYen),
      title: String(milestone.title ?? ''),
      notifyOnReach: milestone.notifyOnReach !== false,
    })), now);
  } catch (error) {
    if (error instanceof NenRankValidationError) return c.json({ success: false, error: error.message }, 400);
    throw error;
  }
  const sync = await syncToEc(c, accountId);
  return c.json({ success: true, data: { ...(await settingsResponse(c, accountId)), sync } });
});

nenRanks.post('/api/nen/rank-settings/resync', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch(() => null);
  const accountId = accountIdFrom(c, body);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  await ensureNenRankDefaults(c.env.DB, accountId);
  const sync = await syncToEc(c, accountId);
  return c.json({ success: true, data: { ...(await settingsResponse(c, accountId)), sync } });
});

nenRanks.get('/api/nen/members', async (c) => {
  const accountId = accountIdFrom(c);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const accountIds: Array<string | null> = scope.allowedAccountIds.includes(accountId) ? [accountId] : [];
  await ensureNenRankDefaults(c.env.DB, accountId);
  const ranks = await getNenRankSettings(c.env.DB, accountId);
  const sortParam = c.req.query('sort');
  const petParam = c.req.query('pet');
  const options: NenMemberListOptions = {
    accountIds,
    rankKey: c.req.query('rank') || null,
    petFilter: petParam === 'with' || petParam === 'without' ? petParam : 'any',
    query: c.req.query('q') ?? '',
    sort: sortParam === 'lifetime_desc' || sortParam === 'balance_desc' || sortParam === 'recent' ? sortParam : 'annual_desc',
    page: Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1),
    pageSize: 20,
  };
  const [{ items, total }, kpis] = await Promise.all([
    listNenMembers(c.env.DB, options),
    getNenMemberKpis(c.env.DB, accountIds),
  ]);
  const data = items.map((row) => {
    const annual = row.member_rank_key ? row.annual_miles_yen : Math.max(row.annual_miles_yen, 0);
    const { rank } = resolveRank(ranks, annual || row.lifetime_miles_yen, row.member_rank_key);
    return {
      friendId: row.friend_id,
      name: row.display_name ?? '',
      pictureUrl: row.picture_url,
      customerId: row.customer_id,
      rankKey: rank?.rank_key ?? null,
      rankName: rank?.name ?? row.member_rank,
      mileRatePercent: row.mile_rate_percent ?? rank?.mile_rate_percent ?? null,
      annualMilesYen: row.annual_miles_yen,
      lifetimeMilesYen: row.lifetime_miles_yen,
      mileBalance: row.mile_balance,
      rankValidUntil: row.rank_valid_until,
      lastPurchasedAt: row.last_purchased_at,
      purchaseCount: row.purchase_count,
      petCount: row.pet_count,
      petNames: row.pet_names,
      syncedAt: row.synced_at,
    };
  });
  return c.json({
    success: true,
    data: {
      items: data,
      total,
      page: options.page,
      pageSize: options.pageSize,
      kpis,
      ranks: ranks.map((rank) => ({ key: rank.rank_key, name: rank.name, annualThresholdYen: rank.annual_threshold_yen, mileRatePercent: rank.mile_rate_percent })),
    },
  });
});

export { nenRanks };
