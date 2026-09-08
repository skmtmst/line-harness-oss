import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getAutoReplies,
  getAutoReplyById,
  createAutoReply,
  updateAutoReply,
  deleteAutoReply,
  getAutoReplyHitCounts,
  getAutoReplyHitCountSince,
  getFriendById,
  getSendableTemplate,
  autoReplyRowFromDraftSettings,
  createAutoReplyWithDraftVersion,
  getAutoReplyDraftVersion,
  getAutoReplyPublishedVersion,
  parseAutoReplyVersionSettings,
  publishAutoReplyDraftVersion,
  recordAutoReplyDraftTest,
  saveAutoReplyDraftVersion,
  jstNow,
  getFolderById,
} from '@line-crm/db';
import type {
  AutoReply as DbAutoReply,
  AutoReplyDraftSettings,
  AutoReplyVersionRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { buildOffsetListResponse, parseOffsetPaging } from '../lib/list-paging.js';
import { currentMonthRange } from '../lib/jst-range.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  compareAutoReplyCandidates,
  evaluateAutoReplyCandidates,
  keywordMatches,
  parseAutoReplyActions,
  previewAutoReplyContent,
  resolveKeywordRules,
  type AutoReplyCandidateReasonCode,
} from '../services/auto-reply.js';

const autoReplies = new Hono<Env>();

async function validateAutoReplyFolder(
  db: D1Database,
  folderId: unknown,
): Promise<string | null> {
  if (folderId === null || folderId === '' || folderId === undefined) return null;
  if (typeof folderId !== 'string') return 'folderId must be a string';
  const folder = await getFolderById(db, folderId);
  if (!folder) return 'フォルダが見つかりません';
  if (folder.kind !== 'auto_reply') return '自動応答用ではないフォルダは選べません';
  return null;
}

async function requireVisibleAutoReply(c: Context<Env>, next: () => Promise<void>) {
  const item = await getAutoReplyById(c.env.DB, c.req.param('id')!);
  if (!item || !await canAccessAllLineAccounts(
    c.env.DB,
    c.get('staff'),
    [item.line_account_id ?? null],
  )) {
    return c.json({ success: false, error: 'Auto-reply not found' }, 404);
  }
  await next();
}

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
  receiveSources: Array<'line' | 'email'>;
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
  /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
  respondToAll: boolean;
  /** 158: 管理用の名前。空なら keyword を代わりに出す。 */
  name: string | null;
  /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
  keywordMatchMode: string;
  /** フォルダ。分けていなければ null。 */
  folderId: string | null;
  /** 152: 当たった回数。一覧でだけ入る。 */
  hits?: { period: number; total: number };
  /** 実行台帳で成功を確認できた後続処理の累計。 */
  actionExecutionCount?: number | null;
  /** 同じ受信に当たり得る、有効な別ルールの数。 */
  conflictAttentionCount?: number | null;
  createdAt: string;
  effectiveAccounts?: EffectiveAccount[];
}

interface AutoReplyDraftInput {
  keyword: string;
  matchType: 'exact' | 'contains';
  responseType: string;
  responseContent: string;
  templateId: string | null;
  lineAccountId: string;
  activeFrom: string | null;
  activeUntil: string | null;
  cooldownMinutes: number | null;
  skipWhenOperatorActive: boolean;
  priority: number;
  messageKinds: string[] | null;
  receiveSources: Array<'line' | 'email'>;
  friendConditions: Record<string, unknown> | null;
  actions: unknown[] | null;
  responseWeekdays: number[] | null;
  responseHolidayRule: 'ignore' | 'include' | 'exclude' | null;
  oncePerFriend: boolean;
  keywords: Array<{
    keyword: string;
    matchType?: 'exact' | 'contains';
    minLength?: number;
    caseSensitive?: boolean;
  }> | null;
  respondToAll: boolean;
  name: string | null;
  keywordMatchMode: 'any' | 'all';
  folderId: string | null;
  internalMemo: string | null;
  replyDelaySeconds: number | null;
  unmatchedAction: Record<string, unknown> | null;
}

interface AutoReplyDraftVersion {
  autoReplyId: string;
  versionId: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'retired';
  settings: AutoReplyDraftInput;
  lastTestStatus: 'succeeded' | 'failed' | null;
  lastTestedAt: string | null;
  publishedAt: string | null;
  matchedLast28Days?: number | null;
}

interface AutoReplyConflict {
  autoReplyId: string;
  name: string;
  certainty: 'certain' | 'possible';
  winnerAutoReplyId: string;
  reason: string;
}

interface AutoReplyConflictPair {
  leftAutoReplyId: string;
  rightAutoReplyId: string;
  winnerAutoReplyId: string;
  certainty: 'certain' | 'possible';
  reason: string;
}

interface AutoReplyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: AutoReplyConflict[];
  lastTestStatus: 'succeeded' | 'failed' | null;
}

interface AutoReplyDryRunResult {
  matched: boolean;
  draftWon: boolean;
  winner: {
    autoReplyId: string;
    name: string;
    responseType: string;
    responseContent: string;
  } | null;
  candidates: Array<{
    autoReplyId: string;
    name: string;
    priority: number;
    result: 'not_matched' | 'skipped' | 'won';
    reasonCodes: AutoReplyCandidateReasonCode[];
  }>;
  actions: Array<{ kind: string }>;
  stateChanged: false;
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
      respondToAll?: boolean;
      name?: string | null;
      keywordMatchMode?: 'any' | 'all';
      folderId?: string | null;
      internalMemo?: string | null;
      replyDelaySeconds?: number | null;
      unmatchedAction?: Record<string, unknown> | null;
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
      return { ok: false, error: `keywords must be an array of { keyword, matchType?, minLength?, caseSensitive? } (at most ${AUTO_REPLY_KEYWORDS_MAX} items, ${AUTO_REPLY_KEYWORD_MAX} characters each)` };
    }
    value.keywords = parsed.value;
  }
  if ('friendConditions' in body) {
    const parsed = readFriendConditions(body.friendConditions);
    if (!parsed.ok) return { ok: false, error: 'friendConditions must be valid JSON' };
    value.friendConditions = parsed.value;
  }
  if ('respondToAll' in body) {
    if (typeof body.respondToAll !== 'boolean') {
      return { ok: false, error: 'respondToAll must be boolean' };
    }
    value.respondToAll = body.respondToAll;
  }
  if ('folderId' in body) {
    if (body.folderId === null || body.folderId === '') {
      value.folderId = null;
    } else if (typeof body.folderId !== 'string') {
      return { ok: false, error: 'folderId must be a string' };
    } else {
      value.folderId = body.folderId;
    }
  }
  if ('keywordMatchMode' in body) {
    if (body.keywordMatchMode !== 'any' && body.keywordMatchMode !== 'all') {
      return { ok: false, error: "keywordMatchMode must be 'any' or 'all'" };
    }
    value.keywordMatchMode = body.keywordMatchMode;
  }
  if ('name' in body) {
    if (body.name === null || body.name === '') {
      value.name = null;
    } else if (typeof body.name !== 'string') {
      return { ok: false, error: 'name must be a string' };
    } else if ([...body.name].length > 250) {
      return { ok: false, error: 'name must be 250 characters or fewer' };
    } else {
      value.name = body.name;
    }
  }
  if ('internalMemo' in body) {
    if (body.internalMemo === null || body.internalMemo === '') {
      value.internalMemo = null;
    } else if (typeof body.internalMemo !== 'string') {
      return { ok: false, error: 'internalMemo must be a string' };
    } else if ([...body.internalMemo].length > 1_000) {
      return { ok: false, error: 'internalMemo must be 1000 characters or fewer' };
    } else {
      value.internalMemo = body.internalMemo;
    }
  }
  if ('replyDelaySeconds' in body) {
    if (body.replyDelaySeconds === null || body.replyDelaySeconds === 0) {
      value.replyDelaySeconds = null;
    } else if (!Number.isInteger(body.replyDelaySeconds)
      || Number(body.replyDelaySeconds) < 0
      || Number(body.replyDelaySeconds) > 86_400) {
      return { ok: false, error: 'replyDelaySeconds must be an integer from 0 to 86400' };
    } else {
      value.replyDelaySeconds = Number(body.replyDelaySeconds);
    }
  }
  if ('unmatchedAction' in body) {
    if (body.unmatchedAction === null) {
      value.unmatchedAction = null;
    } else if (!body.unmatchedAction || typeof body.unmatchedAction !== 'object'
      || Array.isArray(body.unmatchedAction)) {
      return { ok: false, error: 'unmatchedAction must be an object' };
    } else {
      value.unmatchedAction = body.unmatchedAction as Record<string, unknown>;
    }
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
/** 保存できる言葉の上限。際限なく足すと一覧の描画と送信判定が重くなる。 */
export const AUTO_REPLY_KEYWORD_MAX = 200;
export const AUTO_REPLY_KEYWORDS_MAX = 100;
export const AUTO_REPLY_RESPONSE_MAX = 5000;

function readKeywords(raw: unknown): Read<unknown[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.length > AUTO_REPLY_KEYWORDS_MAX) return { ok: false };
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false };
    const r = item as Record<string, unknown>;
    if (typeof r.keyword !== 'string' || r.keyword === '') return { ok: false };
    if ([...r.keyword].length > AUTO_REPLY_KEYWORD_MAX) return { ok: false };
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

function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return JSON.stringify(value);
}

function draftInputFromSettings(settings: AutoReplyDraftSettings): AutoReplyDraftInput {
  return {
    keyword: settings.keyword,
    matchType: settings.matchType,
    responseType: settings.responseType,
    responseContent: settings.responseContent,
    templateId: settings.templateId,
    lineAccountId: settings.lineAccountId ?? '',
    activeFrom: settings.activeFrom,
    activeUntil: settings.activeUntil,
    cooldownMinutes: settings.cooldownMinutes,
    skipWhenOperatorActive: settings.skipWhenOperatorActive,
    priority: settings.priority,
    messageKinds: readJson<string[]>(settings.messageKinds),
    receiveSources: settings.receiveSources,
    friendConditions: readJson<Record<string, unknown>>(settings.friendConditions),
    actions: readJson<unknown[]>(settings.actions),
    responseWeekdays: readJson<number[]>(settings.responseWeekdays),
    responseHolidayRule: settings.responseHolidayRule as AutoReplyDraftInput['responseHolidayRule'],
    oncePerFriend: settings.oncePerFriend,
    keywords: readJson<AutoReplyDraftInput['keywords']>(settings.keywords),
    respondToAll: settings.respondToAll,
    name: settings.name,
    keywordMatchMode: settings.keywordMatchMode === 'all' ? 'all' : 'any',
    folderId: settings.folderId,
    internalMemo: settings.internalMemo ?? null,
    replyDelaySeconds: settings.replyDelaySeconds ?? null,
    unmatchedAction: readJson<Record<string, unknown>>(settings.unmatchedAction),
  };
}

function draftVersionResponse(version: AutoReplyVersionRow): AutoReplyDraftVersion {
  return {
    autoReplyId: version.auto_reply_id,
    versionId: version.id,
    versionNumber: Number(version.version_number),
    status: version.status,
    settings: draftInputFromSettings(parseAutoReplyVersionSettings(version)),
    lastTestStatus: version.last_test_status,
    lastTestedAt: version.last_tested_at,
    publishedAt: version.published_at,
  };
}

type DraftReadResult =
  | { ok: true; value: AutoReplyDraftSettings }
  | { ok: false; error: string };

/** 既存の作成・更新と同じ制約で、公開前の定義だけを読む。 */
async function readDraftSettings(db: D1Database, raw: unknown): Promise<DraftReadResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '設定の形式が正しくありません' };
  }
  const body = raw as Record<string, unknown>;
  const respondToAll = body.respondToAll === true;
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  if (!respondToAll && !keyword) {
    return { ok: false, error: '応答する言葉を入力してください' };
  }
  if ([...keyword].length > AUTO_REPLY_KEYWORD_MAX) {
    return { ok: false, error: `応答する言葉は${AUTO_REPLY_KEYWORD_MAX}文字までです` };
  }
  if (body.matchType !== 'exact' && body.matchType !== 'contains') {
    return { ok: false, error: '言葉の一致方法を選んでください' };
  }
  if (typeof body.lineAccountId !== 'string' || !body.lineAccountId) {
    return { ok: false, error: '対象のLINEアカウントを選んでください' };
  }
  const activeFrom = parseHhmm(body.activeFrom);
  const activeUntil = parseHhmm(body.activeUntil);
  if (!activeFrom.ok || !activeUntil.ok) {
    return { ok: false, error: '応答する時間を24時間表記で入力してください' };
  }
  const cooldown = parseCooldown(body.cooldownMinutes);
  if (!cooldown.ok) return { ok: false, error: '連続応答を止める時間が正しくありません' };
  const priority = readPriority(body.priority ?? 0);
  if (!priority.ok) return { ok: false, error: '優先順位が正しくありません' };
  const messageKinds = readMessageKinds(body.messageKinds);
  if (!messageKinds.ok) return { ok: false, error: '対象にするメッセージの種類が正しくありません' };
  const receiveSources = Array.isArray(body.receiveSources)
    ? [...new Set(body.receiveSources)]
    : ['line'];
  if (receiveSources.length === 0
    || receiveSources.some((source) => source !== 'line' && source !== 'email')) {
    return { ok: false, error: '受信元はLINEまたはメールを1つ以上選んでください' };
  }
  const extras = readExtras(body);
  if (!extras.ok) return { ok: false, error: extras.error };
  // 絞り込みと後続処理は小さな設定のはず。際限なく大きいとDB肥大と描画肥大を招く。
  for (const [key, label] of [['friendConditions', '絞り込み条件'], ['actions', '応答したあとの処理']] as const) {
    const raw = extras.value[key];
    if (raw !== undefined && raw !== null && JSON.stringify(raw).length > 20000) {
      return { ok: false, error: `${label}が大きすぎます` };
    }
  }
  const folderError = await validateAutoReplyFolder(db, extras.value.folderId);
  if (folderError) return { ok: false, error: folderError };
  if (extras.value.actions) {
    const parsedActions = parseAutoReplyActions(JSON.stringify(extras.value.actions));
    if (parsedActions.length !== extras.value.actions.length) {
      return { ok: false, error: '応答したあとにすることの設定を確認してください' };
    }
  }

  const templateId = typeof body.templateId === 'string' && body.templateId ? body.templateId : null;
  let responseType = typeof body.responseType === 'string' && body.responseType ? body.responseType : 'text';
  let responseContent = typeof body.responseContent === 'string' ? body.responseContent : '';
  if (templateId) {
    // 再審査対応(#645): 同一アカウントかつ公開版であること。
    const template = await getSendableTemplate(db, templateId, body.lineAccountId as string);
    if (!template) return { ok: false, error: '選んだテンプレートを確認できません' };
    if (!responseType) responseType = template.message_type;
    if (!responseContent) responseContent = template.message_content;
  }
  if (responseType !== 'silent' && !templateId && !responseContent) {
    return { ok: false, error: '返信する内容を入力してください' };
  }
  // LINEのテキスト上限と同じ基準。試し文の2000字より緩いが、保存文の上限として見る。
  if ([...responseContent].length > AUTO_REPLY_RESPONSE_MAX) {
    return { ok: false, error: `返信する内容は${AUTO_REPLY_RESPONSE_MAX.toLocaleString('ja-JP')}文字までです` };
  }

  return {
    ok: true,
    value: {
      keyword,
      matchType: body.matchType,
      responseType,
      responseContent,
      templateId,
      lineAccountId: body.lineAccountId,
      activeFrom: activeFrom.value,
      activeUntil: activeUntil.value,
      cooldownMinutes: cooldown.value,
      skipWhenOperatorActive: body.skipWhenOperatorActive === true,
      priority: priority.value,
      messageKinds: jsonText(messageKinds.value),
      receiveSources: receiveSources as Array<'line' | 'email'>,
      friendConditions: jsonText(extras.value.friendConditions),
      actions: jsonText(extras.value.actions),
      responseWeekdays: jsonText(extras.value.responseWeekdays),
      responseHolidayRule: extras.value.responseHolidayRule ?? null,
      oncePerFriend: extras.value.oncePerFriend === true,
      keywords: jsonText(extras.value.keywords),
      respondToAll,
      name: extras.value.name ?? null,
      keywordMatchMode: extras.value.keywordMatchMode ?? 'any',
      folderId: extras.value.folderId ?? null,
      internalMemo: extras.value.internalMemo ?? null,
      replyDelaySeconds: extras.value.replyDelaySeconds ?? null,
      unmatchedAction: jsonText(extras.value.unmatchedAction),
    },
  };
}

function messageKindsOverlap(a: DbAutoReply, b: DbAutoReply): boolean {
  const aKinds = readJson<string[]>(a.message_kinds_json);
  const bKinds = readJson<string[]>(b.message_kinds_json);
  if (!aKinds?.length || !bKinds?.length) return true;
  return aKinds.some((kind) => bKinds.includes(kind));
}

function conflictSamples(a: DbAutoReply, b: DbAutoReply): string[] {
  const aWords = resolveKeywordRules(a).map((item) => item.keyword);
  const bWords = resolveKeywordRules(b).map((item) => item.keyword);
  return [
    ...aWords,
    ...bWords,
    aWords.join(' '),
    bWords.join(' '),
    [...aWords, ...bWords].join(' '),
    '確認用のメッセージ',
  ].filter(Boolean);
}

function hasConditionalScope(rule: DbAutoReply): boolean {
  return Boolean(
    rule.active_from
    || rule.active_until
    || rule.response_weekdays_json
    || rule.friend_conditions_json
    || rule.once_per_friend
    || rule.cooldown_minutes
    || rule.skip_when_operator_active,
  );
}

function conflictBetween(draft: DbAutoReply, other: DbAutoReply): AutoReplyConflict | null {
  if (!messageKindsOverlap(draft, other)) return null;
  const overlaps = conflictSamples(draft, other).some(
    (sample) => keywordMatches(draft, sample) && keywordMatches(other, sample),
  );
  const bothContain = resolveKeywordRules(draft).some((item) => item.matchType === 'contains')
    && resolveKeywordRules(other).some((item) => item.matchType === 'contains');
  if (!overlaps && !bothContain) return null;
  const winner = [draft, other].sort(compareAutoReplyCandidates)[0]!;
  const conditional = hasConditionalScope(draft) || hasConditionalScope(other);
  return {
    autoReplyId: other.id,
    name: other.name || other.keyword || '名前は未設定',
    certainty: overlaps && !conditional ? 'certain' : 'possible',
    winnerAutoReplyId: winner.id,
    reason: conditional
      ? '言葉が重なります。曜日・時間・友だち条件によって動く方が変わります。'
      : winner.id === draft.id
        ? '同じメッセージに当たり、この下書きが先に動きます。'
        : '同じメッセージに当たり、既存の自動応答が先に動きます。',
  };
}

async function activeRulesWithDraft(
  db: D1Database,
  autoReplyId: string,
  settings: AutoReplyDraftSettings,
): Promise<DbAutoReply[]> {
  const active = await db.prepare(
    `SELECT * FROM auto_replies
      WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)
      ORDER BY priority ASC, respond_to_all ASC, created_at ASC`,
  ).bind(settings.lineAccountId).all<DbAutoReply>();
  const existing = await getAutoReplyById(db, autoReplyId);
  const draft = autoReplyRowFromDraftSettings(
    autoReplyId,
    settings,
    existing?.created_at ?? jstNow(),
  );
  draft.is_active = 1;
  return [...active.results.filter((item) => item.id !== autoReplyId), draft]
    .sort(compareAutoReplyCandidates);
}

async function conflictsForDraft(
  db: D1Database,
  autoReplyId: string,
  settings: AutoReplyDraftSettings,
): Promise<AutoReplyConflict[]> {
  const candidates = await activeRulesWithDraft(db, autoReplyId, settings);
  const draft = candidates.find((item) => item.id === autoReplyId)!;
  return candidates
    .filter((item) => item.id !== autoReplyId)
    .map((item) => conflictBetween(draft, item))
    .filter((item): item is AutoReplyConflict => item !== null);
}

function conflictPairs(rules: DbAutoReply[]): AutoReplyConflictPair[] {
  const pairs: AutoReplyConflictPair[] = [];
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = rules[leftIndex]!;
      const right = rules[rightIndex]!;
      const conflict = conflictBetween(left, right);
      if (!conflict) continue;
      pairs.push({
        leftAutoReplyId: left.id,
        rightAutoReplyId: right.id,
        winnerAutoReplyId: conflict.winnerAutoReplyId,
        certainty: conflict.certainty,
        reason: conflict.reason,
      });
    }
  }
  return pairs;
}

function conflictCounts(pairs: AutoReplyConflictPair[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.leftAutoReplyId, (counts.get(pair.leftAutoReplyId) ?? 0) + 1);
    counts.set(pair.rightAutoReplyId, (counts.get(pair.rightAutoReplyId) ?? 0) + 1);
  }
  return counts;
}

async function actionExecutionCounts(
  db: D1Database,
  accountId: string | null,
): Promise<Map<string, number>> {
  const result = await db.prepare(
    `SELECT e.winning_auto_reply_id AS auto_reply_id, COUNT(*) AS action_count
       FROM auto_reply_action_runs action_run
       JOIN auto_reply_evaluations e ON e.id = action_run.evaluation_id
      WHERE action_run.status = 'succeeded'
        AND e.winning_auto_reply_id IS NOT NULL
        AND (? IS NULL OR e.line_account_id = ?)
      GROUP BY e.winning_auto_reply_id`,
  ).bind(accountId, accountId).all<{ auto_reply_id: string; action_count: number }>();
  return new Map((result.results ?? [])
    .filter((row) => typeof row.auto_reply_id === 'string')
    .map((row) => [row.auto_reply_id, Number(row.action_count)]));
}

async function autoReplyReceiveSummary(
  db: D1Database,
  accountId: string,
  since: string,
): Promise<{
    receiveSourceCounts: Array<{ source: string; count: number }>;
    matchedLast28Days: number;
  }> {
  const [sources, matched] = await Promise.all([
    db.prepare(
      `SELECT message_kind AS source, COUNT(*) AS count
         FROM auto_reply_evaluations
        WHERE line_account_id = ? AND evaluated_at >= ?
        GROUP BY message_kind
        ORDER BY count DESC, message_kind ASC`,
    ).bind(accountId, since).all<{ source: string; count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM auto_reply_evaluations
        WHERE line_account_id = ? AND evaluated_at >= ?
          AND winning_auto_reply_id IS NOT NULL`,
    ).bind(accountId, since).first<{ count: number }>(),
  ]);
  return {
    receiveSourceCounts: (sources.results ?? []).map((row) => ({
      source: row.source,
      count: Number(row.count),
    })),
    matchedLast28Days: Number(matched?.count ?? 0),
  };
}

async function validateDraft(
  db: D1Database,
  version: AutoReplyVersionRow,
): Promise<AutoReplyValidationResult> {
  const settings = parseAutoReplyVersionSettings(version);
  const errors: string[] = [];
  if (!settings.lineAccountId) errors.push('対象のLINEアカウントを選んでください');
  if (!settings.respondToAll && !settings.keyword) errors.push('応答する言葉を入力してください');
  if (settings.responseType !== 'silent' && !settings.templateId && !settings.responseContent) {
    errors.push('返信する内容を入力してください');
  }
  // 再審査対応(#645): 同一アカウントかつ公開版であること。
  if (settings.templateId
    && !await getSendableTemplate(db, settings.templateId, settings.lineAccountId)) {
    errors.push('選んだテンプレートを確認できません');
  }
  const conflicts = await conflictsForDraft(db, version.auto_reply_id, settings);
  return {
    valid: errors.length === 0,
    errors,
    warnings: conflicts.length > 0
      ? ['同じメッセージに当たる自動応答があります。実際の相手と文面で試してください。']
      : [],
    conflicts,
    lastTestStatus: version.last_test_status,
  };
}

function validIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && value.length >= 8 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value));
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
    receiveSources: ['line'],
    actions: readJson<unknown[]>(row.actions_json),
    responseWeekdays: readJson<number[]>(row.response_weekdays_json),
    responseHolidayRule: row.response_holiday_rule,
    oncePerFriend: Boolean(row.once_per_friend),
    keywords: readJson<unknown[]>(row.keywords_json),
    friendConditions: readJson<unknown>(row.friend_conditions_json),
    respondToAll: Boolean(row.respond_to_all),
    name: row.name,
    keywordMatchMode: row.keyword_match_mode ?? 'any',
    folderId: row.folder_id,
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
autoReplies.get('/api/auto-replies', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId');
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (accountId) {
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: '自動応答を確認できません' }, 404);
      }
    }
    const items = (await getAutoReplies(c.env.DB, accountId || undefined)).filter((item) => {
      const itemAccountId = (item as { line_account_id?: string | null }).line_account_id ?? null;
      return itemAccountId == null
        ? scope.canSeeUnassigned
        : scope.allowedAccountIds.includes(itemAccountId);
    });
    const activeItems = items.filter((item) => item.is_active === 1);
    const conflictsById = conflictCounts(conflictPairs(activeItems));

    // active LINE accounts を取得 + automations の keyword -> accounts インデックスを構築
    const activeAccounts = scope.allowedAccountIds.length
      ? (await c.env.DB
        .prepare(
          `SELECT id, name FROM line_accounts
            WHERE is_active = 1
              AND id IN (${scope.allowedAccountIds.map(() => '?').join(',')})
            ORDER BY name`,
        )
        .bind(...scope.allowedAccountIds)
        .all<{ id: string; name: string }>()).results ?? []
      : [];
    const automationIdx = await buildAutomationKeywordIndex(c.env.DB);

    // 当たった回数（152）。今月と累計を並べて出す。
    // 数が取れなくても一覧は出す。付随情報なので、落ちても本体は止めない。
    const range = currentMonthRange(jstNow());
    // 集計が取れないときは hits を付けない。0 で埋めると画面の
    // 「未取得は —」判定が常に真になり、数え損ないが「未ヒット 0 回」に見える。
    let hitsById: Map<string, { period: number; total: number }> | null = null;
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

    let actionsById: Map<string, number> | null = null;
    try {
      actionsById = await actionExecutionCounts(c.env.DB, accountId || null);
    } catch (err) {
      console.error('GET /api/auto-replies — failed to count action executions', err);
    }

    const data: SerializedAutoReply[] = await Promise.all(
      items.map(async (row) => {
        const base: SerializedAutoReply = {
          ...serializeAutoReply(row),
          ...(hitsById ? { hits: hitsById.get(row.id) ?? { period: 0, total: 0 } } : {}),
          actionExecutionCount: actionsById?.get(row.id) ?? (actionsById ? 0 : null),
          conflictAttentionCount: row.is_active === 1 ? conflictsById.get(row.id) ?? 0 : 0,
        };
        base.effectiveAccounts = await computeEffectiveAccounts(c.env.DB, row, activeAccounts, automationIdx);
        return base;
      }),
    );

    // 共通一覧契約。page/limit を付けたときだけ新形（items/total/limit/sort）で返す。
    // 画面はまだ旧形（配列）を読むため、付けない限り形を変えない。
    if (c.req.query('page') !== undefined || c.req.query('limit') !== undefined) {
      const paging = parseOffsetPaging({ page: c.req.query('page'), limit: c.req.query('limit') });
      return c.json({
        success: true,
        data: buildOffsetListResponse({
          items: data.slice(paging.offset, paging.offset + paging.limit),
          total: data.length,
          paging,
          sort: [
            { field: 'priority', direction: 'asc' },
            { field: 'created_at', direction: 'asc' },
          ],
        }),
      });
    }
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** V6一覧・競合画面用。公開中ルール同士と、直近28日の実測だけを返す。 */
autoReplies.get('/api/auto-replies/conflicts', async (c) => {
  try {
    const accountId = c.req.query('accountId') ?? c.req.query('account_id');
    if (!accountId) {
      return c.json({ success: false, error: 'accountId を指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '自動応答を確認できません' }, 404);
    }
    const rules = (await getAutoReplies(c.env.DB, accountId))
      .filter((item) => item.is_active === 1);
    const conflicts = conflictPairs(rules);
    const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1_000).toISOString();
    let receiveSourceCounts: Array<{ source: string; count: number }> | null = null;
    let matchedLast28Days: number | null = null;
    try {
      const summary = await autoReplyReceiveSummary(c.env.DB, accountId, since);
      receiveSourceCounts = summary.receiveSourceCounts;
      matchedLast28Days = summary.matchedLast28Days;
    } catch (err) {
      console.error('GET /api/auto-replies/conflicts — failed to load receive summary', err);
    }
    return c.json({
      success: true,
      data: {
        conflicts,
        conflictCount: conflicts.length,
        receiveSourceCounts,
        matchedLast28Days,
      },
    });
  } catch (err) {
    console.error('GET /api/auto-replies/conflicts error:', err);
    return c.json({ success: false, error: '競合する自動応答を確認できませんでした' }, 500);
  }
});

/** V6: 新規設定は下書きだけを作り、この時点では返信を始めない。 */
autoReplies.post('/api/auto-replies/drafts', requireRole('owner', 'admin'), async (c) => {
  try {
    const parsed = await readDraftSettings(c.env.DB, await c.req.json());
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [parsed.value.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const created = await createAutoReplyWithDraftVersion(c.env.DB, parsed.value);
    return c.json({ success: true, data: draftVersionResponse(created.version) }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies/drafts error:', err);
    return c.json({ success: false, error: '自動応答の下書きを作成できませんでした' }, 500);
  }
});

// GET /api/auto-replies/:id — get by ID
autoReplies.use('/api/auto-replies/:id', requireVisibleAutoReply);
autoReplies.use('/api/auto-replies/:id/*', requireVisibleAutoReply);
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

autoReplies.get('/api/auto-replies/:id/draft', async (c) => {
  try {
    const id = c.req.param('id');
    const version = await getAutoReplyDraftVersion(c.env.DB, id)
      ?? await getAutoReplyPublishedVersion(c.env.DB, id);
    if (!version) return c.json({ success: false, error: '確認する設定がありません' }, 404);
    let matchedLast28Days: number | null = null;
    try {
      const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1_000).toISOString();
      matchedLast28Days = await getAutoReplyHitCountSince(c.env.DB, version.auto_reply_id, since);
    } catch (err) {
      console.error(JSON.stringify({
        message: 'failed to count 28 day auto reply hits',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return c.json({
      success: true,
      data: { ...draftVersionResponse(version), matchedLast28Days },
    });
  } catch (err) {
    console.error('GET /api/auto-replies/:id/draft error:', err);
    return c.json({ success: false, error: '自動応答の下書きを読み込めませんでした' }, 500);
  }
});

autoReplies.put('/api/auto-replies/:id/draft', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      return c.json({ success: false, error: 'expectedVersion を指定してください' }, 400);
    }
    const current = await getAutoReplyDraftVersion(c.env.DB, c.req.param('id'))
      ?? await getAutoReplyPublishedVersion(c.env.DB, c.req.param('id'));
    if (!current) return c.json({ success: false, error: '自動応答が見つかりません' }, 404);
    if (Number(current.version_number) !== Number(body.expectedVersion)) {
      return c.json({
        success: false,
        code: 'VERSION_CONFLICT',
        error: 'ほかの変更が先に保存されました。最新の状態を読み直してください',
        data: { currentVersion: Number(current.version_number) },
      }, 409);
    }
    const parsed = await readDraftSettings(c.env.DB, body);
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [parsed.value.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const version = await saveAutoReplyDraftVersion(c.env.DB, c.req.param('id'), parsed.value);
    return c.json({ success: true, data: draftVersionResponse(version) });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'AUTO_REPLY_NOT_FOUND') {
      return c.json({ success: false, error: '自動応答が見つかりません' }, 404);
    }
    console.error('PUT /api/auto-replies/:id/draft error:', err);
    return c.json({ success: false, error: '自動応答の下書きを保存できませんでした' }, 500);
  }
});

// 下書きの確認・試運転は、下書きを書ける人だけ。test は成功・失敗どちらの
// 経路でも版の最終テスト状態を書き換える（DB 書込）ため、閲覧権限では叩けない。
autoReplies.post('/api/auto-replies/:id/validate', requireRole('owner', 'admin'), async (c) => {
  try {
    const version = await getAutoReplyDraftVersion(c.env.DB, c.req.param('id'));
    if (!version) return c.json({ success: false, error: '公開する下書きがありません' }, 404);
    return c.json({ success: true, data: await validateDraft(c.env.DB, version) });
  } catch (err) {
    console.error('POST /api/auto-replies/:id/validate error:', err);
    return c.json({ success: false, error: '公開前チェックを実行できませんでした' }, 500);
  }
});

autoReplies.get('/api/auto-replies/:id/conflicts', requireRole('owner', 'admin'), async (c) => {
  try {
    const version = await getAutoReplyDraftVersion(c.env.DB, c.req.param('id'));
    if (!version) return c.json({ success: false, error: '確認する下書きがありません' }, 404);
    const settings = parseAutoReplyVersionSettings(version);
    return c.json({
      success: true,
      data: { conflicts: await conflictsForDraft(c.env.DB, version.auto_reply_id, settings) },
    });
  } catch (err) {
    console.error('GET /api/auto-replies/:id/conflicts error:', err);
    return c.json({ success: false, error: '競合する自動応答を確認できませんでした' }, 500);
  }
});

autoReplies.post('/api/auto-replies/:id/test', requireRole('owner', 'admin'), async (c) => {
  let version: AutoReplyVersionRow | null = null;
  try {
    const id = c.req.param('id');
    version = await getAutoReplyDraftVersion(c.env.DB, id);
    if (!version) return c.json({ success: false, error: '試す下書きがありません' }, 404);
    const settings = parseAutoReplyVersionSettings(version);
    const body = await c.req.json<{
      friendId?: unknown;
      incomingText?: unknown;
      messageKind?: unknown;
      occurredAt?: unknown;
    }>();
    if (typeof body.friendId !== 'string' || !body.friendId) {
      return c.json({ success: false, error: '試す友だちを選んでください' }, 400);
    }
    if (typeof body.incomingText !== 'string' || !body.incomingText.trim()) {
      return c.json({ success: false, error: '試すメッセージを入力してください' }, 400);
    }
    if ([...body.incomingText].length > 2_000) {
      return c.json({ success: false, error: '試すメッセージは2000文字以内にしてください' }, 400);
    }
    const messageKind = body.messageKind ?? 'text';
    if (typeof messageKind !== 'string' || !MESSAGE_KINDS.includes(messageKind)) {
      return c.json({ success: false, error: 'メッセージの種類が正しくありません' }, 400);
    }
    const occurredAt = body.occurredAt === undefined ? new Date() : new Date(String(body.occurredAt));
    if (Number.isNaN(occurredAt.getTime())) {
      return c.json({ success: false, error: '試す日時が正しくありません' }, 400);
    }
    const friend = await getFriendById(c.env.DB, body.friendId);
    if (!friend || friend.line_account_id !== settings.lineAccountId) {
      return c.json({ success: false, error: '選んだアカウントの友だちを確認できません' }, 404);
    }

    const candidates = await activeRulesWithDraft(c.env.DB, id, settings);
    const evaluations = await evaluateAutoReplyCandidates(c.env.DB, candidates, {
      friendId: friend.id,
      incomingText: body.incomingText,
      messageKind,
      now: occurredAt,
    });
    const winner = evaluations.find((item) => item.result === 'won')?.rule ?? null;
    const draftWon = winner?.id === id;
    const preview = winner && winner.response_type !== 'silent'
      ? await previewAutoReplyContent(c.env.DB, friend, winner, c.env.WORKER_URL)
      : winner
        ? { messageType: 'silent', content: '返信せず、設定した処理だけを実行します' }
        : null;
    const result: AutoReplyDryRunResult = {
      matched: winner !== null,
      draftWon,
      winner: winner && preview
        ? {
            autoReplyId: winner.id,
            name: winner.name || winner.keyword || '名前は未設定',
            responseType: preview.messageType,
            responseContent: preview.content,
          }
        : null,
      candidates: evaluations.map((item) => ({
        autoReplyId: item.rule.id,
        name: item.rule.name || item.rule.keyword || '名前は未設定',
        priority: item.rule.priority,
        result: item.result,
        reasonCodes: item.reasonCodes,
      })),
      actions: winner ? parseAutoReplyActions(winner.actions_json).map((action) => ({ kind: action.action_type })) : [],
      stateChanged: false,
    };
    await recordAutoReplyDraftTest(c.env.DB, version.id, {
      succeeded: draftWon,
      staffId: c.get('staff')?.id ?? null,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    if (version) {
      await recordAutoReplyDraftTest(c.env.DB, version.id, {
        succeeded: false,
        staffId: c.get('staff')?.id ?? null,
      });
    }
    console.error('POST /api/auto-replies/:id/test error:', err);
    return c.json({ success: false, error: '自動応答を試せませんでした' }, 500);
  }
});

autoReplies.post('/api/auto-replies/:id/publish', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const requestKey = c.req.header('Idempotency-Key');
    if (!validIdempotencyKey(requestKey)) {
      return c.json({ success: false, error: '公開操作の確認キーが必要です' }, 400);
    }
    const version = await getAutoReplyDraftVersion(c.env.DB, id);
    if (!version) {
      // 同じキーの再実行はDB helperが公開済みの結果を返す。
      const replay = await publishAutoReplyDraftVersion(c.env.DB, id, {
        staffId: c.get('staff')?.id ?? null,
        idempotencyKey: requestKey,
      });
      return c.json({
        success: true,
        data: {
          autoReplyId: id,
          versionId: replay.id,
          versionNumber: Number(replay.version_number),
          publishedAt: replay.published_at,
          acknowledgedConflictIds: [],
        },
      });
    }
    const validation = await validateDraft(c.env.DB, version);
    if (!validation.valid) {
      return c.json({ success: false, error: '公開前チェックに未完了があります', data: validation }, 422);
    }
    if (version.last_test_status !== 'succeeded') {
      return c.json({ success: false, error: 'この下書きを実際の相手と文面で試してください', data: validation }, 422);
    }
    const body: { acknowledgedConflictIds?: unknown } = await c.req
      .json<{ acknowledgedConflictIds?: unknown }>()
      .catch(() => ({}));
    const acknowledged = Array.isArray(body.acknowledgedConflictIds)
      ? body.acknowledgedConflictIds.filter((value): value is string => typeof value === 'string')
      : [];
    const missing = validation.conflicts
      .map((item) => item.autoReplyId)
      .filter((conflictId) => !acknowledged.includes(conflictId));
    if (missing.length > 0) {
      return c.json({
        success: false,
        error: '競合する自動応答を確認してください',
        data: validation,
      }, 409);
    }
    const published = await publishAutoReplyDraftVersion(c.env.DB, id, {
      staffId: c.get('staff')?.id ?? null,
      idempotencyKey: requestKey,
    });
    return c.json({
      success: true,
      data: {
        autoReplyId: id,
        versionId: published.id,
        versionNumber: Number(published.version_number),
        publishedAt: published.published_at,
        acknowledgedConflictIds: acknowledged,
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'AUTO_REPLY_PUBLISH_KEY_CONFLICT') {
      return c.json({ success: false, error: '同じ確認キーが別の公開操作で使われています' }, 409);
    }
    if (code === 'AUTO_REPLY_DRAFT_NOT_FOUND' || code === 'AUTO_REPLY_DRAFT_ALREADY_PUBLISHED') {
      return c.json({ success: false, error: 'この下書きはすでに公開されています' }, 409);
    }
    if (code === 'AUTO_REPLY_DRAFT_NOT_TESTED') {
      return c.json({ success: false, error: 'この下書きを実際の相手と文面で試してください' }, 422);
    }
    console.error('POST /api/auto-replies/:id/publish error:', err);
    return c.json({ success: false, error: '自動応答を有効化できませんでした' }, 500);
  }
});

// POST /api/auto-replies — create
// 用途: 一覧の編集ダイアログからの新規作成と、既存ルールの直接更新（PUT :id）。
// 下書き経由（PUT :id/draft → validate/conflicts/test → publish）に寄せていない
// 理由: 新規作成時は下書きが存在せず、版の取得・テスト必須の公開フローに
// 乗せられない。公開前のテスト・競合確認は公開画面のフローで担保する。
// いずれも owner/admin 専用で、本文の長さ上限は下書きと同じ基準を見る。
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
      respondToAll?: boolean;
      name?: string | null;
      keywordMatchMode?: 'any' | 'all';
      folderId?: string | null;
    }>();

    // 一律で応答するルール（157）はキーワードを見ないので、空でも作れる。
    // ただし列は NOT NULL なので、空文字を入れておく。
    if (!body.keyword && body.respondToAll !== true) {
      return c.json({ success: false, error: 'keyword is required' }, 400);
    }
    if (typeof body.keyword === 'string' && [...body.keyword].length > AUTO_REPLY_KEYWORD_MAX) {
      return c.json({ success: false, error: `keyword must be ${AUTO_REPLY_KEYWORD_MAX} characters or fewer` }, 400);
    }
    if (typeof body.responseContent === 'string' && [...body.responseContent].length > AUTO_REPLY_RESPONSE_MAX) {
      return c.json({ success: false, error: `responseContent must be ${AUTO_REPLY_RESPONSE_MAX} characters or fewer` }, 400);
    }
    if (body.lineAccountId !== null && body.lineAccountId !== undefined
      && (!body.lineAccountId
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId]))) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    // template_id があれば content は空でも OK (template から resolve される)。
    // silent も content 不要。それ以外は inline content 必須。
    if (!body.templateId && !body.responseContent && body.responseType !== 'silent') {
      return c.json({ success: false, error: 'templateId or responseContent required (unless responseType=silent)' }, 400);
    }
    // 再審査対応(#645): 関連付け時に同一アカウントかつ公開版であること。
    if (body.templateId) {
      const { getSendableTemplate } = await import('@line-crm/db');
      const sendable = await getSendableTemplate(c.env.DB, body.templateId, body.lineAccountId ?? null);
      if (!sendable) {
        return c.json({ success: false, error: '選んだテンプレートを確認できません' }, 400);
      }
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
      // 再審査対応(#645): 未公開・別アカウントの本文を控えにしない。
      const { getSendableTemplate } = await import('@line-crm/db');
      const tpl = await getSendableTemplate(c.env.DB, body.templateId, body.lineAccountId ?? null);
      if (tpl) {
        if (!body.responseType) resolvedResponseType = tpl.message_type;
        if (!body.responseContent) resolvedResponseContent = tpl.message_content;
      }
    }

    const extras = readExtras(body as Record<string, unknown>);
    if (!extras.ok) return c.json({ success: false, error: extras.error }, 400);
    const folderError = await validateAutoReplyFolder(c.env.DB, extras.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);

    const item = await createAutoReply(c.env.DB, {
      ...extras.value,
      keyword: body.keyword ?? '',
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
    if (body.keyword !== undefined) {
      if (typeof body.keyword === 'string' && [...body.keyword].length > AUTO_REPLY_KEYWORD_MAX) {
        return c.json({ success: false, error: `keyword must be ${AUTO_REPLY_KEYWORD_MAX} characters or fewer` }, 400);
      }
      input.keyword = body.keyword;
    }
    if (body.matchType !== undefined) input.matchType = body.matchType;
    if (body.responseType !== undefined) input.responseType = body.responseType;
    if (body.responseContent !== undefined) {
      if (typeof body.responseContent === 'string' && [...body.responseContent].length > AUTO_REPLY_RESPONSE_MAX) {
        return c.json({ success: false, error: `responseContent must be ${AUTO_REPLY_RESPONSE_MAX} characters or fewer` }, 400);
      }
      input.responseContent = body.responseContent;
    }
    if ('templateId' in body) input.templateId = body.templateId;
    // 再審査対応(#645): 関連付け時に同一アカウントかつ公開版であること。
    if (body.templateId) {
      const { getSendableTemplate } = await import('@line-crm/db');
      const target = await getAutoReplyById(c.env.DB, id);
      if (!target) return c.json({ success: false, error: 'Auto-reply not found' }, 404);
      const sendable = await getSendableTemplate(
        c.env.DB, body.templateId, body.lineAccountId ?? target.line_account_id,
      );
      if (!sendable) {
        return c.json({ success: false, error: '選んだテンプレートを確認できません' }, 400);
      }
    }
    if ('lineAccountId' in body) {
      if (body.lineAccountId !== null && body.lineAccountId !== undefined) {
        if (!body.lineAccountId
          || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
          return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
        }
      }
      input.lineAccountId = body.lineAccountId;
    }
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
    // 再審査対応(#645): 未公開・別アカウントの本文を控えにしない。
    // アカウントは body がなければ既存ルールのものを見る。
    if (body.templateId && body.responseContent === undefined) {
      const { getSendableTemplate } = await import('@line-crm/db');
      const existing = await getAutoReplyById(c.env.DB, id);
      if (!existing) return c.json({ success: false, error: 'Auto-reply not found' }, 404);
      const tpl = await getSendableTemplate(
        c.env.DB, body.templateId, body.lineAccountId ?? existing.line_account_id,
      );
      if (tpl) {
        input.responseContent = tpl.message_content;
        if (body.responseType === undefined) input.responseType = tpl.message_type;
      }
    }

    const extras = readExtras(body as Record<string, unknown>);
    if (!extras.ok) return c.json({ success: false, error: extras.error }, 400);
    const folderError = await validateAutoReplyFolder(c.env.DB, extras.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);
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
