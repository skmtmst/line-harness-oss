import { Hono } from 'hono';
import {
  getAutoReplies,
  getAutoReplyById,
  createAutoReply,
  updateAutoReply,
  deleteAutoReply,
  getAutoReplyHitCounts,
  jstNow,
} from '@line-crm/db';
import type { AutoReply as DbAutoReply } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
// 集計の期間（その月の1日〜翌月1日、日本時間）はリッチメニューと同じもの。
// 置き場所が rich-menu-tap.ts なのは、そちらで先に要ったため。共通の置き場へ
// 移すのは #189 が入ってから（いま動かすとレビュー中の差分が変わる）。
import { currentMonthRange } from '../lib/rich-menu-tap.js';

const autoReplies = new Hono<Env>();

/** LINE から届くメッセージの種別。ここに無いものは対象にできない。 */
const MESSAGE_KINDS = ['text', 'image', 'video', 'audio', 'file', 'location', 'sticker', 'postback'];

function readPriority(raw: unknown): { ok: true; value: number } | { ok: false } {
  const n = Number(raw);
  // 上下に余裕を持たせる。間に挿し込めないと、並べ替えのたびに
  // 全件を振り直すことになる。
  if (!Number.isInteger(n) || n < -9999 || n > 9999) return { ok: false };
  return { ok: true, value: n };
}

function readMessageKinds(raw: unknown): { ok: true; value: string[] | null } | { ok: false } {
  if (raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return { ok: true, value: null };
  }
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.some((v) => typeof v !== 'string' || !MESSAGE_KINDS.includes(v))) return { ok: false };
  return { ok: true, value: raw as string[] };
}


/** "HH:MM"（24時間表記）かどうか。空文字と null は「指定なし」。 */
function parseHhmm(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return { ok: false };
  return { ok: true, value };
}

/** 分。0 は「抑制しない」なので null に寄せる。 */
function parseCooldown(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_080) return { ok: false };
  return { ok: true, value: n === 0 ? null : n };
}

interface EffectiveAccount {
  accountId: string;
  accountName: string;
  status: 'reply' | 'silent' | 'not_applicable';
  via: 'inline' | 'automation' | null;
}

interface SerializedAutoReply {
  id: string;
  keyword: string;
  matchType: 'exact' | 'contains';
  responseType: string;
  responseContent: string;
  templateId: string | null;
  lineAccountId: string | null;
  isActive: boolean;
  activeFrom: string | null;
  activeUntil: string | null;
  cooldownMinutes: number | null;
  skipWhenOperatorActive: boolean;
  priority: number;
  messageKinds: string[] | null;
  /** 151: 応答したときに順に実行すること。 */
  actions: unknown[] | null;
  /** 151: 応答する曜日（0=日 … 6=土）。null なら曜日を問わない。 */
  responseWeekdays: number[] | null;
  /** 151: 'ignore' | 'include' | 'exclude'。 */
  responseHolidayRule: string | null;
  /** 151: 1人につき1回だけ応答する。 */
  oncePerFriend: boolean;
  /** 151: キーワードの複数行。null なら keyword / matchType を見る。 */
  keywords: unknown[] | null;
  /** 友だちの絞り込み（一斉配信・シナリオと同じ形）。 */
  friendConditions: unknown | null;
  /** 152: 当たった回数。一覧でだけ入る。 */
  hits?: { period: number; total: number };
  createdAt: string;
  effectiveAccounts?: EffectiveAccount[];
}

const HOLIDAY_RULES = ['ignore', 'include', 'exclude'] as const;
/** 151 で増えた設定をまとめて読む。作成と更新で同じものを使う。 */
function readExtras(body: Record<string, unknown>):
  | { ok: true; value: {
      actions?: unknown[] | null;
      responseWeekdays?: number[] | null;
      responseHolidayRule?: string | null;
      oncePerFriend?: boolean;
      keywords?: unknown[] | null;
      friendConditions?: unknown | null;
    } }
  | { ok: false; error: string } {
  const value: Record<string, unknown> = {};

  if ('actions' in body) {
    const parsed = readActions(body.actions);
    if (!parsed.ok) return { ok: false, error: 'actions must be an array' };
    value.actions = parsed.value;
  }
  if ('responseWeekdays' in body) {
    const parsed = readWeekdays(body.responseWeekdays);
    if (!parsed.ok) return { ok: false, error: 'responseWeekdays must be integers from 0 (Sun) to 6 (Sat)' };
    value.responseWeekdays = parsed.value;
  }
  if ('responseHolidayRule' in body) {
    const parsed = readHolidayRule(body.responseHolidayRule);
    if (!parsed.ok) return { ok: false, error: `responseHolidayRule must be one of ${HOLIDAY_RULES.join(', ')}` };
    value.responseHolidayRule = parsed.value;
  }
  if ('oncePerFriend' in body) {
    if (typeof body.oncePerFriend !== 'boolean') {
      return { ok: false, error: 'oncePerFriend must be boolean' };
    }
    value.oncePerFriend = body.oncePerFriend;
  }
  if ('keywords' in body) {
    const parsed = readKeywords(body.keywords);
    if (!parsed.ok) {
      return { ok: false, error: 'keywords must be an array of { keyword, matchType?, minLength?, caseSensitive? }' };
    }
    value.keywords = parsed.value;
  }
  if ('friendConditions' in body) {
    const parsed = readFriendConditions(body.friendConditions);
    if (!parsed.ok) return { ok: false, error: 'friendConditions must be valid JSON' };
    value.friendConditions = parsed.value;
  }

  return { ok: true, value };
}



type Read<T> = { ok: true; value: T } | { ok: false };

/** 応答したときに実行することの並び。 */
function readActions(raw: unknown): Read<unknown[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  return { ok: true, value: raw.length > 0 ? raw : null };
}

/** 応答する曜日（0=日 … 6=土）。 */
function readWeekdays(raw: unknown): Read<number[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.some((v) => !Number.isInteger(v) || (v as number) < 0 || (v as number) > 6)) {
    return { ok: false };
  }
  return { ok: true, value: raw.length > 0 ? (raw as number[]) : null };
}

function readHolidayRule(raw: unknown): Read<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || !HOLIDAY_RULES.includes(raw as (typeof HOLIDAY_RULES)[number])) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

/** キーワードの複数行。1行ずつ言葉と当て方を持つ。 */
function readKeywords(raw: unknown): Read<unknown[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false };
    const r = item as Record<string, unknown>;
    if (typeof r.keyword !== 'string' || r.keyword === '') return { ok: false };
    if (r.matchType !== undefined && r.matchType !== 'exact' && r.matchType !== 'contains') {
      return { ok: false };
    }
    if (r.minLength !== undefined && (!Number.isInteger(r.minLength) || (r.minLength as number) < 0)) {
      return { ok: false };
    }
  }
  return { ok: true, value: raw.length > 0 ? raw : null };
}

/**
 * 友だちの絞り込み。読めない JSON は断る。
 *
 * 保存できてしまうと、応答のたびに黙って「返さない」に倒れる（判定側が
 * そうしている）。設定した人からは、当たるはずのルールが動かないだけに見える。
 */
function readFriendConditions(raw: unknown): Read<unknown | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === 'object') return { ok: true, value: raw };
  if (typeof raw === 'string') {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

/** 保存されている JSON を読む。壊れていても画面を落とさない。 */
function readJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function serializeAutoReply(row: DbAutoReply): SerializedAutoReply {
  return {
    id: row.id,
    keyword: row.keyword,
    matchType: row.match_type,
    responseType: row.response_type,
    responseContent: row.response_content,
    templateId: row.template_id,
    lineAccountId: row.line_account_id,
    isActive: Boolean(row.is_active),
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    cooldownMinutes: row.cooldown_minutes,
    skipWhenOperatorActive: Boolean(row.skip_when_operator_active),
    priority: Number(row.priority ?? 0),
    messageKinds: row.message_kinds_json
      ? (JSON.parse(row.message_kinds_json) as string[])
      : null,
    actions: readJson<unknown[]>(row.actions_json),
    responseWeekdays: readJson<number[]>(row.response_weekdays_json),
    responseHolidayRule: row.response_holiday_rule,
    oncePerFriend: Boolean(row.once_per_friend),
    keywords: readJson<unknown[]>(row.keywords_json),
    friendConditions: readJson<unknown>(row.friend_conditions_json),
    createdAt: row.created_at,
  };
}

/**
 * 全 active LINE accounts と全 active automations を一発で取って、各 auto_reply の
 * 「実際にどのアカで返信するか」を計算する。auto_reply の line_account_id が null
 * なら全アカ対象、specific なら対象 1 アカのみ。返信は inline (silent 以外) または
 * 同 keyword の automation rule (event_type='message_received') で起きる。
 */
async function computeEffectiveAccounts(
  db: D1Database,
  rule: DbAutoReply,
  accounts: Array<{ id: string; name: string }>,
  automationsByKeyword: Map<string, Set<string>>,  // keyword -> set of account_ids that have rule
): Promise<EffectiveAccount[]> {
  return accounts.map((acc) => {
    // line_account_id が specific なら対象アカ以外は適用外
    if (rule.line_account_id && rule.line_account_id !== acc.id) {
      return { accountId: acc.id, accountName: acc.name, status: 'not_applicable', via: null };
    }
    // inline 返信 (text / flex / image)
    if (rule.response_type !== 'silent') {
      return { accountId: acc.id, accountName: acc.name, status: 'reply', via: 'inline' };
    }
    // silent: 同 keyword の automation rule が同アカに存在すれば返信、無ければ silent only
    const automationAccs = automationsByKeyword.get(rule.keyword);
    if (automationAccs?.has(acc.id)) {
      return { accountId: acc.id, accountName: acc.name, status: 'reply', via: 'automation' };
    }
    return { accountId: acc.id, accountName: acc.name, status: 'silent', via: null };
  });
}

async function buildAutomationKeywordIndex(db: D1Database): Promise<Map<string, Set<string>>> {
  // event_type='message_received' で keyword を持ち、send_message を含む automation を全件取って
  // keyword -> set<account_id> のインデックス化。
  const res = await db
    .prepare(`SELECT line_account_id, conditions, actions FROM automations WHERE is_active = 1 AND event_type = 'message_received'`)
    .all<{ line_account_id: string | null; conditions: string; actions: string }>();
  const idx = new Map<string, Set<string>>();
  for (const r of res.results ?? []) {
    if (!r.line_account_id) continue;  // global rules — skip; UI assumes per-account
    let keyword: string | null = null;
    try {
      const c = JSON.parse(r.conditions) as { keyword?: string; keyword_exact?: string };
      keyword = c.keyword ?? c.keyword_exact ?? null;
    } catch { continue; }
    if (!keyword) continue;
    // send_message action があるか
    let hasSendMessage = false;
    try {
      const acts = JSON.parse(r.actions) as Array<{ type: string }>;
      hasSendMessage = acts.some((a) => a.type === 'send_message');
    } catch { continue; }
    if (!hasSendMessage) continue;
    const set = idx.get(keyword) ?? new Set<string>();
    set.add(r.line_account_id);
    idx.set(keyword, set);
  }
  return idx;
}

// GET /api/auto-replies — list all auto-replies (optional ?accountId filter)
autoReplies.get('/api/auto-replies', async (c) => {
  try {
    const accountId = c.req.query('accountId');
    const items = await getAutoReplies(c.env.DB, accountId || undefined);

    // active LINE accounts を取得 + automations の keyword -> accounts インデックスを構築
    const accRes = await c.env.DB
      .prepare(`SELECT id, name FROM line_accounts WHERE is_active = 1 ORDER BY name`)
      .all<{ id: string; name: string }>();
    const activeAccounts = accRes.results ?? [];
    const automationIdx = await buildAutomationKeywordIndex(c.env.DB);

    // 当たった回数（152）。今月と累計を並べて出す。
    // 数が取れなくても一覧は出す。付随情報なので、落ちても本体は止めない。
    const range = currentMonthRange(jstNow());
    let hitsById = new Map<string, { period: number; total: number }>();
    try {
      const counts = await getAutoReplyHitCounts(
        c.env.DB,
        accountId || null,
        range.from,
        range.to,
      );
      hitsById = new Map(counts.map((h) => [h.autoReplyId, { period: h.period, total: h.total }]));
    } catch (err) {
      console.error('GET /api/auto-replies — failed to count hits', err);
    }

    const data: SerializedAutoReply[] = await Promise.all(
      items.map(async (row) => {
        const base = { ...serializeAutoReply(row), hits: hitsById.get(row.id) ?? { period: 0, total: 0 } };
        base.effectiveAccounts = await computeEffectiveAccounts(c.env.DB, row, activeAccounts, automationIdx);
        return base;
      }),
    );

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/auto-replies/:id — get by ID
autoReplies.get('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    return c.json({ success: true, data: serializeAutoReply(item) });
  } catch (err) {
    console.error('GET /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/auto-replies — create
autoReplies.post('/api/auto-replies', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      activeFrom?: unknown;
      activeUntil?: unknown;
      cooldownMinutes?: unknown;
      skipWhenOperatorActive?: unknown;
      priority?: unknown;
      messageKinds?: unknown;
    }>();

    if (!body.keyword) {
      return c.json({ success: false, error: 'keyword is required' }, 400);
    }
    // template_id があれば content は空でも OK (template から resolve される)。
    // silent も content 不要。それ以外は inline content 必須。
    if (!body.templateId && !body.responseContent && body.responseType !== 'silent') {
      return c.json({ success: false, error: 'templateId or responseContent required (unless responseType=silent)' }, 400);
    }

    const activeFrom = parseHhmm(body.activeFrom);
    const activeUntil = parseHhmm(body.activeUntil);
    const cooldown = parseCooldown(body.cooldownMinutes);
    if (!activeFrom.ok || !activeUntil.ok) {
      return c.json({ success: false, error: 'activeFrom/activeUntil must be HH:MM' }, 400);
    }
    if (!cooldown.ok) {
      return c.json(
        { success: false, error: 'cooldownMinutes must be an integer between 0 and 10080' },
        400,
      );
    }
    const priority = body.priority === undefined ? { ok: true as const, value: 0 } : readPriority(body.priority);
    if (!priority.ok) {
      return c.json({ success: false, error: 'priority must be an integer between -9999 and 9999' }, 400);
    }
    const messageKinds = readMessageKinds(body.messageKinds);
    if (!messageKinds.ok) {
      return c.json(
        { success: false, error: `messageKinds must be an array of ${MESSAGE_KINDS.join(', ')}` },
        400,
      );
    }

    // template_id が来てて content/type が空の場合、template の現在値を inline
    // snapshot として保存する。これがないと ON DELETE SET NULL で template_id が
    // クリアされた時に webhook resolve が空メッセージにフォールバックしてしまう。
    let resolvedResponseType = body.responseType ?? 'text';
    let resolvedResponseContent = body.responseContent ?? '';
    if (body.templateId && (!body.responseContent || !body.responseType)) {
      const { getTemplateById } = await import('@line-crm/db');
      const tpl = await getTemplateById(c.env.DB, body.templateId);
      if (tpl) {
        if (!body.responseType) resolvedResponseType = tpl.message_type;
        if (!body.responseContent) resolvedResponseContent = tpl.message_content;
      }
    }

    const extras = readExtras(body as Record<string, unknown>);
    if (!extras.ok) return c.json({ success: false, error: extras.error }, 400);

    const item = await createAutoReply(c.env.DB, {
      ...extras.value,
      keyword: body.keyword,
      matchType: body.matchType,
      responseType: resolvedResponseType,
      responseContent: resolvedResponseContent,
      templateId: body.templateId ?? null,
      lineAccountId: body.lineAccountId ?? null,
      activeFrom: activeFrom.value,
      activeUntil: activeUntil.value,
      cooldownMinutes: cooldown.value,
      skipWhenOperatorActive: body.skipWhenOperatorActive === true,
      priority: priority.value,
      messageKinds: messageKinds.value,
    });

    return c.json({ success: true, data: serializeAutoReply(item) }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/auto-replies/:id — update
autoReplies.put('/api/auto-replies/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      isActive?: boolean;
      activeFrom?: unknown;
      activeUntil?: unknown;
      cooldownMinutes?: unknown;
      skipWhenOperatorActive?: unknown;
      priority?: unknown;
      messageKinds?: unknown;
    }>();

    const input: Record<string, unknown> = {};
    if (body.keyword !== undefined) input.keyword = body.keyword;
    if (body.matchType !== undefined) input.matchType = body.matchType;
    if (body.responseType !== undefined) input.responseType = body.responseType;
    if (body.responseContent !== undefined) input.responseContent = body.responseContent;
    if ('templateId' in body) input.templateId = body.templateId;
    if ('lineAccountId' in body) input.lineAccountId = body.lineAccountId;
    if (body.isActive !== undefined) input.isActive = body.isActive;
    if ('activeFrom' in body) {
      const parsed = parseHhmm(body.activeFrom);
      if (!parsed.ok) return c.json({ success: false, error: 'activeFrom must be HH:MM' }, 400);
      input.activeFrom = parsed.value;
    }
    if ('activeUntil' in body) {
      const parsed = parseHhmm(body.activeUntil);
      if (!parsed.ok) return c.json({ success: false, error: 'activeUntil must be HH:MM' }, 400);
      input.activeUntil = parsed.value;
    }
    if ('cooldownMinutes' in body) {
      const parsed = parseCooldown(body.cooldownMinutes);
      if (!parsed.ok) {
        return c.json(
          { success: false, error: 'cooldownMinutes must be an integer between 0 and 10080' },
          400,
        );
      }
      input.cooldownMinutes = parsed.value;
    }
    if ('skipWhenOperatorActive' in body) {
      input.skipWhenOperatorActive = body.skipWhenOperatorActive === true;
    }
    if ('priority' in body) {
      const parsed = readPriority(body.priority);
      if (!parsed.ok) {
        return c.json({ success: false, error: 'priority must be an integer between -9999 and 9999' }, 400);
      }
      input.priority = parsed.value;
    }
    if ('messageKinds' in body) {
      const parsed = readMessageKinds(body.messageKinds);
      if (!parsed.ok) {
        return c.json(
          { success: false, error: `messageKinds must be an array of ${MESSAGE_KINDS.join(', ')}` },
          400,
        );
      }
      input.messageKinds = parsed.value;
    }

    // templateId が新たに set されて responseContent が来てない場合は template の
    // 現在値を inline snapshot として書き込む (ON DELETE SET NULL の fallback 用)。
    if (body.templateId && body.responseContent === undefined) {
      const { getTemplateById } = await import('@line-crm/db');
      const tpl = await getTemplateById(c.env.DB, body.templateId);
      if (tpl) {
        input.responseContent = tpl.message_content;
        if (body.responseType === undefined) input.responseType = tpl.message_type;
      }
    }

    const extras = readExtras(body as Record<string, unknown>);
    if (!extras.ok) return c.json({ success: false, error: extras.error }, 400);
    Object.assign(input, extras.value);

    const updated = await updateAutoReply(c.env.DB, id, input as Parameters<typeof updateAutoReply>[2]);

    if (!updated) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }

    return c.json({ success: true, data: serializeAutoReply(updated) });
  } catch (err) {
    console.error('PUT /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/auto-replies/:id
autoReplies.delete('/api/auto-replies/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    await deleteAutoReply(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { autoReplies };
