/**
 * 飲食店向け「Googleビジネス」第2段：プロフィール・営業時間・変更履歴。
 * 設計正本：Googleビジネス正本.pen GB-10（R4a3qH）/ GB-11（N8Ipp4）/ GB-11-B（Ldvmo）/ GB-11-C（LbQ05）
 *           / GB-12（t73h64）/ GB-17（w7ZTml）/ GB-18（V5jnSa）/ GB-19（pRLAQ）
 * 要件：claude/requirements-google-business-stage2-hours-20260925.md、決定：claude/decision-google-business-stage2-scope-20260925.md
 *
 * 考え方
 * - Google からの読み取りは rt_google_profiles に写しを持ち、10分より古ければ裏で取り直す。
 * - 変更は「案（draft）→ 確認 → 送信」。案は rt_google_changes に残し、GB-17 の変更履歴にもなる。
 * - 送信直前に必ず最新を取り直し、案を作ったときの値と違えば送らない（変更競合）。
 * - Google の specialHours / regularHours は全置換なので、最新の全体に対象日・曜日だけ差し替えて送る。
 * - 書き込みは GOOGLE_BUSINESS_WRITE_ENABLED=true の環境だけ。送信は owner / admin だけ。
 * - AI へ渡すのは基準日・TZ・通常営業時間・祝日・入力文だけ。予約への影響は件数だけを返す（予約者名は出さない）。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getMediaById } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { dbFor } from '../services/db-router.js';
import { GoogleBusinessError, type RequestOptions } from '../services/google-business.js';
import {
  DESCRIPTION_MAX_LENGTH,
  WEEKDAYS,
  WEEKDAY_JA,
  addDays,
  buildHoursParsePrompt,
  createMedia,
  deleteMedia,
  effectiveHoursFor,
  emptyWeekly,
  formatPeriods,
  getProfile,
  isValidDate,
  isValidTime,
  listMedia,
  parseHoursResponse,
  patchProfile,
  todayIn,
  validatePeriods,
  validateSpecialDay,
  validateWeekly,
  weekdayOf,
  type GoogleProfile,
  type HoursPeriod,
  type ProfileAddress,
  type ProfilePatch,
  type SpecialDay,
  type Weekday,
  type WeeklyHours,
} from '../services/google-business-profile.js';
import { holidayNameOf, upcomingHolidays } from '../services/jp-holidays.js';
import {
  GoogleAiTimeout,
  accessTokenFor,
  connectionFor,
  fail,
  googleAccessGuard,
  googleErrorResponse,
  googlePermissions,
  nowIso,
  requireConnectedStore,
  runGoogleAi,
  setConnectionStatus,
  storeFor,
  writeEnabled,
  type ConnectionRow,
  type StoreContext,
} from './restaurant-google.js';

export const restaurantGoogleProfile = new Hono<Env>();
restaurantGoogleProfile.use('/api/restaurant-test/google/*', googleAccessGuard);

/** 写しがこれより古ければ取り直す。 */
export const PROFILE_STALE_AFTER_MS = 10 * 60 * 1000;
const HOLIDAY_WINDOW_DAYS_MAX = 90;
const TEXT_INPUT_MAX = 500;
const HISTORY_LIMIT_MAX = 100;
const REGULAR_IMPACT_DAYS = 28;
const TITLE_MAX = 100;
const PHONE_MAX = 20;
const WEBSITE_MAX = 200;

type ChangeKind = 'special_hours' | 'regular_hours' | 'profile' | 'photo';
type ChangeSource = 'shortcut' | 'text' | 'calendar' | 'weekly' | 'profile_edit' | 'photo';
type ChangeStatus = 'draft' | 'pending_confirm' | 'accepted' | 'applied' | 'failed' | 'conflict' | 'cancelled';

interface ProfileRow {
  store_id: string;
  location_name: string;
  profile_json: string;
  fingerprint: string;
  fetched_at: string;
}

interface ChangeRow {
  id: string;
  store_id: string;
  kind: ChangeKind;
  source: ChangeSource;
  summary: string;
  target_json: string;
  before_json: string | null;
  after_json: string;
  input_text: string | null;
  reservation_impact_count: number;
  base_fingerprint: string | null;
  status: ChangeStatus;
  staff_id: string | null;
  staff_name: string | null;
  request_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  applied_at: string | null;
  updated_at: string;
}

/** 変更案の対象。営業時間は日付か曜日、プロフィールは項目名、写真は追加／削除。 */
type ChangeTarget =
  | { dates: string[] }
  | { weekdays: Weekday[] }
  | { field: 'title' | 'phone' | 'websiteUri' | 'description' | 'address' }
  | { field: 'photo'; action: 'add' | 'delete' };

/** 1日分の変更前後（special_hours）。 */
interface DayHours {
  date: string;
  closed: boolean;
  periods: HoursPeriod[];
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function publicChange(row: ChangeRow) {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    summary: row.summary,
    target: parseJson<ChangeTarget>(row.target_json, { dates: [] }),
    before: parseJson<unknown>(row.before_json, null),
    after: parseJson<unknown>(row.after_json, null),
    inputText: row.input_text,
    reservationImpactCount: row.reservation_impact_count,
    status: row.status,
    staffName: row.staff_name,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 店舗・プロフィールの写し ----------

async function storeTimeZone(c: Context<Env>, storeId: string): Promise<string> {
  const row = await dbFor(c.env, storeId).prepare('SELECT timezone FROM rt_stores WHERE id = ? LIMIT 1').bind(storeId).first<{ timezone: string | null }>();
  return row?.timezone || 'Asia/Tokyo';
}

async function cachedProfile(c: Context<Env>, storeId: string): Promise<{ profile: GoogleProfile; fetchedAt: string } | null> {
  const row = await dbFor(c.env, storeId).prepare('SELECT * FROM rt_google_profiles WHERE store_id = ? LIMIT 1').bind(storeId).first<ProfileRow>();
  if (!row) return null;
  const profile = parseJson<GoogleProfile | null>(row.profile_json, null);
  if (!profile) return null;
  return { profile, fetchedAt: row.fetched_at };
}

async function saveProfile(c: Context<Env>, storeId: string, locationName: string, profile: GoogleProfile): Promise<string> {
  const fetchedAt = nowIso();
  await dbFor(c.env, storeId)
    .prepare(
      `INSERT INTO rt_google_profiles (store_id, location_name, profile_json, fingerprint, fetched_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(store_id) DO UPDATE SET location_name = excluded.location_name, profile_json = excluded.profile_json,
         fingerprint = excluded.fingerprint, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    )
    .bind(storeId, locationName, JSON.stringify(profile), profile.fingerprint, fetchedAt, fetchedAt)
    .run();
  return fetchedAt;
}

/** Google から取り直して写しを更新する。失敗時は接続状態も更新して例外を投げる。 */
async function refreshProfile(c: Context<Env>, store: StoreContext, connection: ConnectionRow): Promise<{ profile: GoogleProfile; fetchedAt: string }> {
  try {
    const accessToken = await accessTokenFor(c, connection);
    const profile = await getProfile({ fetch, accessToken }, connection.location_name!);
    const fetchedAt = await saveProfile(c, store.id, connection.location_name!, profile);
    if (connection.status !== 'connected') await setConnectionStatus(c, store.id, 'connected', null);
    return { profile, fetchedAt };
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    throw error;
  }
}

/** 写しが新しければそれを、古ければ取り直して返す。取り直しに失敗しても写しがあればそれを返す（stale=true）。 */
async function profileFor(
  c: Context<Env>,
  store: StoreContext,
  connection: ConnectionRow,
  force = false,
): Promise<{ profile: GoogleProfile; fetchedAt: string; stale: boolean; refreshError: string | null } | Response> {
  const cached = await cachedProfile(c, store.id);
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Number.POSITIVE_INFINITY;
  if (cached && !force && age < PROFILE_STALE_AFTER_MS) return { ...cached, stale: false, refreshError: null };
  try {
    const fresh = await refreshProfile(c, store, connection);
    return { ...fresh, stale: false, refreshError: null };
  } catch (error) {
    if (cached) return { ...cached, stale: true, refreshError: error instanceof GoogleBusinessError ? error.kind : 'unknown' };
    return googleErrorResponse(c, error);
  }
}

function storeClosed(profile: GoogleProfile): boolean {
  return profile.openStatus === 'CLOSED_TEMPORARILY' || profile.openStatus === 'CLOSED_PERMANENTLY';
}

function profilePayload(profile: GoogleProfile, timeZone: string, holidayDays: number) {
  const today = todayIn(timeZone);
  const todayWeekday = weekdayOf(today);
  const todayHours = effectiveHoursFor(profile, today);
  const holidays = upcomingHolidays(today, holidayDays).map((h) => {
    const special = profile.specialHours.find((s) => s.date === h.date) ?? null;
    return { ...h, weekday: weekdayOf(h.date), special };
  });
  return {
    profile: {
      name: profile.name,
      title: profile.title,
      address: profile.address,
      phone: profile.phone,
      websiteUri: profile.websiteUri,
      description: profile.description,
      openStatus: profile.openStatus,
      regularHours: profile.regularHours,
      specialHours: profile.specialHours.filter((s) => s.date >= today),
      mapsUri: profile.mapsUri,
    },
    today: { date: today, weekday: todayWeekday, holidayName: holidayNameOf(today), ...todayHours },
    holidays,
    timeZone,
    closed: storeClosed(profile),
  };
}

async function pendingCount(c: Context<Env>, storeId: string): Promise<number> {
  const row = await dbFor(c.env, storeId)
    .prepare(`SELECT COUNT(*) AS n FROM rt_google_changes WHERE store_id = ? AND status IN ('pending_confirm', 'accepted')`)
    .bind(storeId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function profileResponse(c: Context<Env>, store: StoreContext, connection: ConnectionRow, force: boolean) {
  const result = await profileFor(c, store, connection, force);
  if (result instanceof Response) return result;
  const timeZone = await storeTimeZone(c, store.id);
  const days = Math.min(HOLIDAY_WINDOW_DAYS_MAX, Math.max(1, Number.parseInt(c.req.query('holiday_days') ?? '30', 10) || 30));
  return c.json({
    success: true,
    store: { id: store.id, name: store.name, lineAccountId: store.lineAccountId },
    ...profilePayload(result.profile, timeZone, days),
    fetchedAt: result.fetchedAt,
    stale: result.stale,
    refreshError: result.refreshError,
    pendingChangeCount: await pendingCount(c, store.id),
    writeEnabled: writeEnabled(c.env),
    aiAvailable: Boolean(c.env.AI),
    permissions: { ...(await googlePermissions(c)), canSendChange: c.get('staff')?.role === 'owner' || c.get('staff')?.role === 'admin' },
  });
}

// ---------- 予約への影響（件数だけ） ----------

function localDateTime(iso: string, timeZone: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function withinPeriods(time: string, periods: HoursPeriod[]): boolean {
  const t = Number.parseInt(time.slice(0, 2), 10) * 60 + Number.parseInt(time.slice(3, 5), 10);
  const min = (v: string) => Number.parseInt(v.slice(0, 2), 10) * 60 + Number.parseInt(v.slice(3, 5), 10);
  return periods.some((p) => {
    const open = min(p.open);
    const close = p.close === '00:00' ? 24 * 60 : min(p.close);
    return close <= open ? t >= open : t >= open && t < close;
  });
}

/**
 * 変更後の営業時間の外に始まる予約（未来・未キャンセル）の件数。
 * dayHours: 日付 → 変更後の枠（closed なら全件が対象）。
 */
async function countReservationImpact(c: Context<Env>, storeId: string, timeZone: string, dayHours: Map<string, { closed: boolean; periods: HoursPeriod[] }>): Promise<number> {
  if (dayHours.size === 0) return 0;
  const dates = [...dayHours.keys()].sort();
  const from = `${addDays(dates[0], -1)}T00:00:00.000Z`;
  const to = `${addDays(dates[dates.length - 1], 2)}T00:00:00.000Z`;
  const rows = await dbFor(c.env, storeId)
    .prepare(`SELECT starts_at FROM rt_reservations WHERE store_id = ? AND status IN ('pending', 'confirmed') AND starts_at >= ? AND starts_at < ? LIMIT 2000`)
    .bind(storeId, from, to)
    .all<{ starts_at: string }>();
  let count = 0;
  for (const row of rows.results) {
    const local = localDateTime(row.starts_at, timeZone);
    if (!local) continue;
    const hours = dayHours.get(local.date);
    if (!hours) continue;
    if (hours.closed || !withinPeriods(local.time, hours.periods)) count += 1;
  }
  return count;
}

// ---------- 変更案の作成 ----------

function fmtDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number.parseInt(m, 10)}/${Number.parseInt(d, 10)}（${WEEKDAY_JA[weekdayOf(date)]}）`;
}

function summaryForSpecial(days: DayHours[]): string {
  const dates = days.map((d) => fmtDate(d.date)).join('・');
  const first = days[0];
  const allSame = days.every((d) => d.closed === first.closed && formatPeriods(d.periods) === formatPeriods(first.periods));
  return allSame ? `${dates}を${first.closed ? '休業' : formatPeriods(first.periods)}に` : `${dates}の営業時間を変更`;
}

function summaryForRegular(weekdays: Weekday[], weekly: WeeklyHours): string {
  const names = weekdays.map((d) => WEEKDAY_JA[d]).join('・');
  const first = weekdays[0];
  const allSame = weekdays.every((d) => formatPeriods(weekly[d], '定休日') === formatPeriods(weekly[first], '定休日'));
  return allSame ? `毎週 ${names}曜を${formatPeriods(weekly[first], '定休日')}に` : `毎週 ${names}曜の営業時間を変更`;
}

async function insertChange(
  c: Context<Env>,
  store: StoreContext,
  input: { kind: ChangeKind; source: ChangeSource; summary: string; target: ChangeTarget; before: unknown; after: unknown; inputText?: string | null; impact: number; baseFingerprint: string },
): Promise<ChangeRow> {
  const id = crypto.randomUUID();
  const staff = c.get('staff');
  await dbFor(c.env, store.id)
    .prepare(
      `INSERT INTO rt_google_changes
         (id, store_id, kind, source, summary, target_json, before_json, after_json, input_text, reservation_impact_count, base_fingerprint, status, staff_id, staff_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      store.id,
      input.kind,
      input.source,
      input.summary,
      JSON.stringify(input.target),
      input.before === undefined ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.inputText ?? null,
      input.impact,
      input.baseFingerprint,
      staff?.id ?? null,
      staff?.name ?? null,
      nowIso(),
      nowIso(),
    )
    .run();
  return (await changeFor(c, store.id, id))!;
}

async function changeFor(c: Context<Env>, storeId: string, id: string): Promise<ChangeRow | null> {
  return dbFor(c.env, storeId).prepare('SELECT * FROM rt_google_changes WHERE id = ? AND store_id = ? LIMIT 1').bind(id, storeId).first<ChangeRow>();
}

async function updateChange(c: Context<Env>, storeId: string, id: string, patch: { status: ChangeStatus; error?: string | null; requestId?: string | null; sentAt?: string | null; appliedAt?: string | null }): Promise<void> {
  await dbFor(c.env, storeId)
    .prepare(
      `UPDATE rt_google_changes
       SET status = ?, error = ?, request_id = COALESCE(?, request_id), sent_at = COALESCE(?, sent_at), applied_at = COALESCE(?, applied_at), updated_at = ?
       WHERE id = ? AND store_id = ?`,
    )
    .bind(patch.status, patch.error ?? null, patch.requestId ?? null, patch.sentAt ?? null, patch.appliedAt ?? null, nowIso(), id, storeId)
    .run();
}

/** 1日だけの変更案（special_hours）を作る。dates ごとに after を持つ。 */
async function proposeSpecial(
  c: Context<Env>,
  store: StoreContext,
  profile: GoogleProfile,
  timeZone: string,
  source: ChangeSource,
  days: DayHours[],
  inputText: string | null,
): Promise<ChangeRow | Response> {
  const today = todayIn(timeZone);
  const seen = new Set<string>();
  for (const d of days) {
    if (seen.has(d.date)) return fail(c, 400, `同じ日付が2回あります（${d.date}）`, { code: 'invalid_request' });
    seen.add(d.date);
    const v = validateSpecialDay({ date: d.date, closed: d.closed, periods: d.periods }, today);
    if (!v.ok) return fail(c, 400, `${fmtDate(d.date)}：${v.reason}`, { code: 'invalid_request' });
  }
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, closed: d.closed, periods: d.closed ? [] : d.periods }));
  const before: DayHours[] = sorted.map((d) => {
    const h = effectiveHoursFor(profile, d.date);
    return { date: d.date, closed: h.closed, periods: h.periods };
  });
  const unchanged = sorted.every((d, i) => d.closed === before[i].closed && formatPeriods(d.periods) === formatPeriods(before[i].periods));
  if (unchanged) return fail(c, 409, 'すでにその営業時間になっています', { code: 'unchanged' });
  const impact = await countReservationImpact(c, store.id, timeZone, new Map(sorted.map((d) => [d.date, { closed: d.closed, periods: d.periods }])));
  return insertChange(c, store, {
    kind: 'special_hours',
    source,
    summary: summaryForSpecial(sorted),
    target: { dates: sorted.map((d) => d.date) },
    before,
    after: sorted,
    inputText,
    impact,
    baseFingerprint: profile.fingerprint,
  });
}

/** 毎週の変更案（regular_hours）。after は全曜日、target は変わった曜日。 */
async function proposeRegular(
  c: Context<Env>,
  store: StoreContext,
  profile: GoogleProfile,
  timeZone: string,
  source: ChangeSource,
  weekly: WeeklyHours,
  inputText: string | null,
): Promise<ChangeRow | Response> {
  const v = validateWeekly(weekly);
  if (!v.ok) return fail(c, 400, v.reason, { code: 'invalid_request' });
  const changed = WEEKDAYS.filter((d) => formatPeriods(weekly[d], '-') !== formatPeriods(profile.regularHours[d], '-'));
  if (changed.length === 0) return fail(c, 409, 'すでにその営業時間になっています', { code: 'unchanged' });
  const before: Partial<WeeklyHours> = {};
  for (const d of changed) before[d] = profile.regularHours[d];
  const today = todayIn(timeZone);
  const dayHours = new Map<string, { closed: boolean; periods: HoursPeriod[] }>();
  for (let i = 0; i < REGULAR_IMPACT_DAYS; i += 1) {
    const date = addDays(today, i);
    const wd = weekdayOf(date);
    if (!changed.includes(wd)) continue;
    if (profile.specialHours.some((s) => s.date === date)) continue; // 特別営業時間が優先される日は影響なし
    dayHours.set(date, { closed: weekly[wd].length === 0, periods: weekly[wd] });
  }
  const impact = await countReservationImpact(c, store.id, timeZone, dayHours);
  return insertChange(c, store, {
    kind: 'regular_hours',
    source,
    summary: summaryForRegular(changed, weekly),
    target: { weekdays: changed },
    before,
    after: weekly,
    inputText,
    impact,
    baseFingerprint: profile.fingerprint,
  });
}

function parsePeriods(value: unknown): HoursPeriod[] | null {
  if (!Array.isArray(value)) return null;
  const out: HoursPeriod[] = [];
  for (const p of value) {
    if (!p || typeof p !== 'object') return null;
    const { open, close } = p as { open?: unknown; close?: unknown };
    if (typeof open !== 'string' || typeof close !== 'string') return null;
    out.push({ open, close });
  }
  return out;
}

function parseWeekly(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== 'object') return null;
  const weekly = emptyWeekly();
  for (const d of WEEKDAYS) {
    const periods = parsePeriods((value as Record<string, unknown>)[d] ?? []);
    if (!periods) return null;
    weekly[d] = periods;
  }
  return weekly;
}

async function requireOpenProfile(c: Context<Env>): Promise<{ store: StoreContext; connection: ConnectionRow; profile: GoogleProfile; timeZone: string } | Response> {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const result = await profileFor(c, ctx.store, ctx.connection);
  if (result instanceof Response) return result;
  if (storeClosed(result.profile)) return fail(c, 409, 'Google側で「臨時休業」または「閉業」になっています。解除はGoogleビジネスプロフィールで行ってください', { code: 'store_closed' });
  return { ...ctx, profile: result.profile, timeZone: await storeTimeZone(c, ctx.store.id) };
}

// ---------- プロフィール ----------

restaurantGoogleProfile.get('/api/restaurant-test/google/profile', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  return profileResponse(c, ctx.store, ctx.connection, false);
});

restaurantGoogleProfile.post('/api/restaurant-test/google/profile/sync', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  return profileResponse(c, ctx.store, ctx.connection, true);
});

restaurantGoogleProfile.get('/api/restaurant-test/google/holidays', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const result = await profileFor(c, ctx.store, ctx.connection);
  if (result instanceof Response) return result;
  const timeZone = await storeTimeZone(c, ctx.store.id);
  const days = Math.min(HOLIDAY_WINDOW_DAYS_MAX, Math.max(1, Number.parseInt(c.req.query('days') ?? '30', 10) || 30));
  const today = todayIn(timeZone);
  const holidays = upcomingHolidays(today, days).map((h) => ({
    ...h,
    weekday: weekdayOf(h.date),
    special: result.profile.specialHours.find((s) => s.date === h.date) ?? null,
    regular: result.profile.regularHours[weekdayOf(h.date)],
  }));
  return c.json({ success: true, today, days, holidays });
});

// ---------- 営業時間の変更案 ----------

/**
 * body:
 *  { source: 'shortcut', shortcut: 'close_today' }
 *  { source: 'shortcut', shortcut: 'early_close_today', closeTime: 'HH:MM' }
 *  { source: 'text', text: '...' }
 *  { source: 'calendar', days: [{ date, closed, periods }] }
 *  { source: 'weekly', weekly: { MONDAY: [...], ... } }
 * 応答: { success, change } または（文章があいまいなとき）{ success, question }
 */
restaurantGoogleProfile.post('/api/restaurant-test/google/hours/propose', async (c) => {
  const ctx = await requireOpenProfile(c);
  if (ctx instanceof Response) return ctx;
  const { store, profile, timeZone } = ctx;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const today = todayIn(timeZone);

  if (body.source === 'shortcut') {
    if (body.shortcut === 'close_today') {
      const change = await proposeSpecial(c, store, profile, timeZone, 'shortcut', [{ date: today, closed: true, periods: [] }], null);
      return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
    }
    if (body.shortcut === 'early_close_today') {
      const closeTime = typeof body.closeTime === 'string' ? body.closeTime : '';
      if (!isValidTime(closeTime)) return fail(c, 400, '閉店時刻を選んでください', { code: 'invalid_request' });
      const current = effectiveHoursFor(profile, today);
      if (current.closed || current.periods.length === 0) return fail(c, 409, '今日は休業のため、閉店時刻の変更はできません', { code: 'closed_today' });
      const periods = current.periods.map((p) => ({ ...p }));
      const last = periods[periods.length - 1];
      const kept = periods.filter((p) => p !== last && p.close <= closeTime && p.close > p.open);
      const v = validatePeriods([...kept, { open: last.open, close: closeTime }]);
      if (!v.ok || closeTime <= last.open) return fail(c, 400, '閉店時刻は最後の枠の開始より後にしてください', { code: 'invalid_request' });
      const change = await proposeSpecial(c, store, profile, timeZone, 'shortcut', [{ date: today, closed: false, periods: [...kept, { open: last.open, close: closeTime }] }], null);
      return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
    }
    return fail(c, 400, 'shortcut が不正です', { code: 'invalid_request' });
  }

  if (body.source === 'calendar') {
    if (!Array.isArray(body.days) || body.days.length === 0) return fail(c, 400, '日付を選んでください', { code: 'invalid_request' });
    const days: DayHours[] = [];
    for (const raw of body.days) {
      const d = raw as { date?: unknown; closed?: unknown; periods?: unknown };
      const periods = parsePeriods(d.periods ?? []);
      if (typeof d.date !== 'string' || !isValidDate(d.date) || !periods) return fail(c, 400, '日付か時刻の形式が正しくありません', { code: 'invalid_request' });
      days.push({ date: d.date, closed: d.closed === true, periods });
    }
    const change = await proposeSpecial(c, store, profile, timeZone, 'calendar', days, null);
    return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
  }

  if (body.source === 'weekly') {
    const weekly = parseWeekly(body.weekly);
    if (!weekly) return fail(c, 400, '曜日ごとの営業時間の形式が正しくありません', { code: 'invalid_request' });
    const change = await proposeRegular(c, store, profile, timeZone, 'weekly', weekly, null);
    return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
  }

  if (body.source === 'text') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return fail(c, 400, '変更したい内容を入力してください', { code: 'invalid_request' });
    if (text.length > TEXT_INPUT_MAX) return fail(c, 400, `入力は${TEXT_INPUT_MAX}文字までです`, { code: 'invalid_request' });
    if (!c.env.AI) return fail(c, 503, 'かんたん入力はこの環境では使えません', { code: 'ai_unavailable' });
    const prompt = buildHoursParsePrompt({
      storeTitle: profile.title ?? store.name,
      timeZone,
      today,
      todayWeekday: weekdayOf(today),
      regularHours: profile.regularHours,
      text,
      holidays: upcomingHolidays(today, 60),
    });
    let raw = '';
    try {
      raw = await runGoogleAi(c, prompt, { temperature: 0.1, maxTokens: 400 });
    } catch (error) {
      console.error('[restaurant-google] hours parse failed', { code: error instanceof GoogleAiTimeout ? 'timeout' : 'provider_failure' });
      return fail(c, error instanceof GoogleAiTimeout ? 504 : 502, '読み取りに失敗しました。もう一度お試しください', { code: error instanceof GoogleAiTimeout ? 'ai_timeout' : 'ai_failed' });
    }
    const parsed = parseHoursResponse(raw);
    if (!parsed) return c.json({ success: true, question: '日付・曜日と時間をもう少し具体的に教えてください（例：9/25（金）は 11:00–20:00）' });
    if (parsed.kind === 'question') return c.json({ success: true, question: parsed.question });
    if (parsed.kind === 'special') {
      const days: DayHours[] = parsed.dates.map((date) => ({ date, closed: parsed.closed, periods: parsed.periods }));
      const v = days.map((d) => validateSpecialDay(d, today)).find((r) => !r.ok);
      if (v && !v.ok) return c.json({ success: true, question: `${v.reason}。日付と時間をもう一度教えてください` });
      const change = await proposeSpecial(c, store, profile, timeZone, 'text', days, text);
      return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
    }
    const weekly = emptyWeekly();
    for (const d of WEEKDAYS) weekly[d] = profile.regularHours[d];
    for (const d of parsed.weekdays) weekly[d] = parsed.closed ? [] : parsed.periods;
    const vw = validateWeekly(weekly);
    if (!vw.ok) return c.json({ success: true, question: `${vw.reason}。時間をもう一度教えてください` });
    const change = await proposeRegular(c, store, profile, timeZone, 'text', weekly, text);
    return change instanceof Response ? change : c.json({ success: true, change: publicChange(change) });
  }

  return fail(c, 400, 'source が不正です', { code: 'invalid_request' });
});

// ---------- プロフィール項目・写真の変更案 ----------

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function cleanText(value: unknown, max: number, allowNewline = false): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  if (CONTROL_CHARS.test(text)) return null;
  if (!allowNewline && text.includes('\n')) return null;
  if (text.length > max) return null;
  return text;
}

const PROFILE_FIELD_JA: Record<string, string> = { title: '店舗名', phone: '電話番号', websiteUri: 'ウェブサイト', description: '店舗紹介', address: '住所' };

function addressText(a: ProfileAddress | null): string {
  if (!a) return '';
  return [a.postalCode ? `〒${a.postalCode}` : '', a.administrativeArea ?? '', a.locality ?? '', ...a.addressLines].filter(Boolean).join(' ');
}

/**
 * body:
 *  { field: 'title' | 'phone' | 'websiteUri' | 'description', value: string }
 *  { field: 'address', value: { postalCode, administrativeArea, locality, addressLines: [] } }
 *  { field: 'photo', action: 'add', mediaId }          … 登録メディア（GB-8）の画像を店舗写真に追加
 *  { field: 'photo', action: 'delete', mediaName }     … Google 上の写真を削除
 */
restaurantGoogleProfile.post('/api/restaurant-test/google/profile/propose', async (c) => {
  const ctx = await requireOpenProfile(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection, profile } = ctx;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const field = body.field;

  if (field === 'photo') {
    if (body.action === 'add') {
      const mediaId = typeof body.mediaId === 'string' ? body.mediaId : '';
      if (!mediaId) return fail(c, 400, '写真を選んでください', { code: 'invalid_request' });
      const media = await getMediaById(dbFor(c.env), mediaId, store.lineAccountId);
      if (!media || media.kind !== 'image' || media.archived_at) return fail(c, 404, '登録メディアに写真が見つかりません', { code: 'media_not_found' });
      const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
      const sourceUrl = media.public_url ?? `${workerUrl}/images/${media.r2_key}`;
      const change = await insertChange(c, store, {
        kind: 'photo',
        source: 'photo',
        summary: `写真を追加（${media.filename}）`,
        target: { field: 'photo', action: 'add' },
        before: null,
        after: { action: 'add', mediaId: media.id, filename: media.filename, sourceUrl },
        impact: 0,
        baseFingerprint: profile.fingerprint,
      });
      return c.json({ success: true, change: publicChange(change) });
    }
    if (body.action === 'delete') {
      const mediaName = typeof body.mediaName === 'string' ? body.mediaName : '';
      if (!mediaName.startsWith(`${connection.location_name}/media/`)) return fail(c, 400, '削除する写真が正しくありません', { code: 'invalid_request' });
      const change = await insertChange(c, store, {
        kind: 'photo',
        source: 'photo',
        summary: '写真を削除',
        target: { field: 'photo', action: 'delete' },
        before: { mediaName },
        after: { action: 'delete', mediaName },
        impact: 0,
        baseFingerprint: profile.fingerprint,
      });
      return c.json({ success: true, change: publicChange(change) });
    }
    return fail(c, 400, 'action が不正です', { code: 'invalid_request' });
  }

  let patch: ProfilePatch;
  let before: unknown;
  if (field === 'title') {
    const value = cleanText(body.value, TITLE_MAX);
    if (!value) return fail(c, 400, `店舗名は1〜${TITLE_MAX}文字で入力してください`, { code: 'invalid_request' });
    patch = { field: 'title', value };
    before = profile.title;
  } else if (field === 'phone') {
    const value = cleanText(body.value, PHONE_MAX);
    if (value === null || (value && !/^\+?[0-9][0-9 ()-]*$/.test(value))) return fail(c, 400, '電話番号は数字とハイフンで入力してください', { code: 'invalid_request' });
    patch = { field: 'phone', value: value || null };
    before = profile.phone;
  } else if (field === 'websiteUri') {
    const value = cleanText(body.value, WEBSITE_MAX);
    if (value === null) return fail(c, 400, 'ウェブサイトのURLが正しくありません', { code: 'invalid_request' });
    if (value) {
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
      } catch {
        return fail(c, 400, 'ウェブサイトは https:// から始まるURLを入力してください', { code: 'invalid_request' });
      }
    }
    patch = { field: 'websiteUri', value: value || null };
    before = profile.websiteUri;
  } else if (field === 'description') {
    const value = cleanText(body.value, DESCRIPTION_MAX_LENGTH, true);
    if (value === null) return fail(c, 400, `店舗紹介は${DESCRIPTION_MAX_LENGTH}文字までです`, { code: 'invalid_request' });
    patch = { field: 'description', value: value || null };
    before = profile.description;
  } else if (field === 'address') {
    const v = (body.value ?? {}) as Record<string, unknown>;
    const postalCode = cleanText(v.postalCode ?? '', 8);
    const administrativeArea = cleanText(v.administrativeArea ?? '', 20);
    const locality = cleanText(v.locality ?? '', 40);
    const lines = Array.isArray(v.addressLines) ? v.addressLines.map((l) => cleanText(l, 80)) : null;
    if (postalCode === null || !/^\d{3}-?\d{4}$/.test(postalCode)) return fail(c, 400, '郵便番号は 123-4567 の形で入力してください', { code: 'invalid_request' });
    if (!administrativeArea || !locality) return fail(c, 400, '都道府県と市区町村を入力してください', { code: 'invalid_request' });
    if (!lines || lines.length === 0 || lines.length > 3 || lines.some((l) => !l)) return fail(c, 400, '番地・建物名を1〜3行で入力してください', { code: 'invalid_request' });
    const value: ProfileAddress = { postalCode, administrativeArea, locality, addressLines: lines as string[] };
    patch = { field: 'address', value };
    before = profile.address;
  } else {
    return fail(c, 400, 'field が不正です', { code: 'invalid_request' });
  }

  const same = patch.field === 'address' ? addressText(patch.value) === addressText(profile.address) : (patch.value ?? '') === (before ?? '');
  if (same) return fail(c, 409, '変更がありません', { code: 'unchanged' });
  const change = await insertChange(c, store, {
    kind: 'profile',
    source: 'profile_edit',
    summary: `${PROFILE_FIELD_JA[patch.field]}を変更`,
    target: { field: patch.field },
    before,
    after: patch.value,
    impact: 0,
    baseFingerprint: profile.fingerprint,
  });
  return c.json({ success: true, change: publicChange(change) });
});

restaurantGoogleProfile.get('/api/restaurant-test/google/photos', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  try {
    const accessToken = await accessTokenFor(c, ctx.connection);
    const photos = await listMedia({ fetch, accessToken }, ctx.connection.location_name!);
    return c.json({ success: true, photos });
  } catch (error) {
    return googleErrorResponse(c, error);
  }
});

// ---------- 変更の確認・送信・履歴 ----------

restaurantGoogleProfile.get('/api/restaurant-test/google/changes', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const limit = Math.min(HISTORY_LIMIT_MAX, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const kind = c.req.query('kind');
  const where = ['store_id = ?', `status <> 'draft'`];
  const binds: unknown[] = [store.id];
  if (kind === 'hours') where.push(`kind IN ('special_hours', 'regular_hours')`);
  else if (kind === 'profile') where.push(`kind IN ('profile', 'photo')`);
  const rows = await dbFor(c.env, store.id)
    .prepare(`SELECT * FROM rt_google_changes WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<ChangeRow>();
  return c.json({ success: true, changes: rows.results.map(publicChange) });
});

restaurantGoogleProfile.get('/api/restaurant-test/google/changes/:id', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await changeFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '変更案が見つかりません');
  const timeZone = await storeTimeZone(c, store.id);
  const staff = c.get('staff');
  return c.json({
    success: true,
    change: publicChange(row),
    store: { id: store.id, name: store.name, timeZone },
    writeEnabled: writeEnabled(c.env),
    canSend: staff?.role === 'owner' || staff?.role === 'admin',
  });
});

restaurantGoogleProfile.post('/api/restaurant-test/google/changes/:id/cancel', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await changeFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '変更案が見つかりません');
  if (row.status !== 'draft' && row.status !== 'failed' && row.status !== 'conflict') return fail(c, 409, 'この変更は取り消せません', { code: 'not_cancellable' });
  await updateChange(c, store.id, row.id, { status: 'cancelled' });
  return c.json({ success: true, change: publicChange((await changeFor(c, store.id, row.id))!) });
});

/** 変更案の対象だけを最新プロフィールから切り出す（競合判定・反映判定用）。 */
function sliceOf(profile: GoogleProfile, row: ChangeRow): unknown {
  const target = parseJson<ChangeTarget>(row.target_json, { dates: [] });
  if (row.kind === 'special_hours' && 'dates' in target) {
    return target.dates.map((date) => {
      const h = effectiveHoursFor(profile, date);
      return { date, closed: h.closed, periods: h.periods };
    });
  }
  if (row.kind === 'regular_hours' && 'weekdays' in target) {
    const out: Partial<WeeklyHours> = {};
    for (const d of target.weekdays) out[d] = profile.regularHours[d];
    return out;
  }
  if (row.kind === 'profile' && 'field' in target) {
    switch (target.field) {
      case 'title':
        return profile.title;
      case 'phone':
        return profile.phone;
      case 'websiteUri':
        return profile.websiteUri;
      case 'description':
        return profile.description;
      case 'address':
        return profile.address;
      default:
        return null;
    }
  }
  return null;
}

function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return v ?? '';
  };
  return JSON.stringify(norm(value));
}

/** 案の「変更後」を最新プロフィールと比べるための形にそろえる（regular は対象曜日だけ）。 */
function expectedSlice(row: ChangeRow): unknown {
  const target = parseJson<ChangeTarget>(row.target_json, { dates: [] });
  const after = parseJson<unknown>(row.after_json, null);
  if (row.kind === 'regular_hours' && 'weekdays' in target) {
    const weekly = after as WeeklyHours;
    const out: Partial<WeeklyHours> = {};
    for (const d of target.weekdays) out[d] = weekly[d];
    return out;
  }
  if (row.kind === 'special_hours') {
    return (after as DayHours[]).map((d) => ({ date: d.date, closed: d.closed, periods: d.closed ? [] : d.periods }));
  }
  return after;
}

/** 送信するペイロード（全置換に備え、最新の全体へ対象だけ差し替える）。 */
function buildSendPatch(latest: GoogleProfile, row: ChangeRow): ProfilePatch {
  const after = parseJson<unknown>(row.after_json, null);
  if (row.kind === 'special_hours') {
    const days = after as DayHours[];
    const byDate = new Map<string, SpecialDay>(latest.specialHours.map((s) => [s.date, s]));
    for (const d of days) byDate.set(d.date, { date: d.date, closed: d.closed, periods: d.closed ? [] : d.periods });
    return { field: 'specialHours', value: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }
  if (row.kind === 'regular_hours') {
    const target = parseJson<ChangeTarget>(row.target_json, { weekdays: [] });
    const weekly = emptyWeekly();
    for (const d of WEEKDAYS) weekly[d] = latest.regularHours[d];
    if ('weekdays' in target) for (const d of target.weekdays) weekly[d] = (after as WeeklyHours)[d];
    return { field: 'regularHours', value: weekly };
  }
  const target = parseJson<ChangeTarget>(row.target_json, { dates: [] });
  const field = 'field' in target ? target.field : null;
  switch (field) {
    case 'title':
      return { field: 'title', value: after as string };
    case 'phone':
      return { field: 'phone', value: (after as string | null) ?? null };
    case 'websiteUri':
      return { field: 'websiteUri', value: (after as string | null) ?? null };
    case 'description':
      return { field: 'description', value: (after as string | null) ?? null };
    case 'address':
      return { field: 'address', value: after as ProfileAddress };
    default:
      throw new Error('unsupported_change');
  }
}

restaurantGoogleProfile.post('/api/restaurant-test/google/changes/:id/send', requireRole('owner', 'admin'), async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  const row = await changeFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '変更案が見つかりません');
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({}) as { confirmed?: boolean });
  if (body.confirmed !== true) return fail(c, 400, '店舗・日付・時間の確認が必要です', { code: 'confirmation_required' });
  if (!writeEnabled(c.env)) return fail(c, 403, 'この環境ではGoogleへ送信できません', { code: 'write_disabled' });
  if (row.status === 'applied' || row.status === 'accepted') return fail(c, 409, 'この変更はすでに送信済みです', { code: 'already_sent' });
  if (row.status === 'cancelled') return fail(c, 409, 'この変更は取り消されています', { code: 'cancelled' });

  let options: RequestOptions;
  try {
    options = { fetch, accessToken: await accessTokenFor(c, connection) };
  } catch (error) {
    return googleErrorResponse(c, error);
  }

  // 送信直前に最新を取り直す（別の担当者の変更／前回の送信が届いているかを照合）。
  let latest: GoogleProfile;
  try {
    latest = await getProfile(options, connection.location_name!);
    await saveProfile(c, store.id, connection.location_name!, latest);
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    return googleErrorResponse(c, error);
  }

  if (row.kind !== 'photo') {
    const current = sliceOf(latest, row);
    if (canonical(current) === canonical(expectedSlice(row))) {
      await updateChange(c, store.id, row.id, { status: 'applied', appliedAt: nowIso(), sentAt: row.sent_at ?? nowIso() });
      return c.json({ success: true, alreadyApplied: true, change: publicChange((await changeFor(c, store.id, row.id))!) });
    }
    if (row.status !== 'pending_confirm' && canonical(current) !== canonical(parseJson<unknown>(row.before_json, null))) {
      await updateChange(c, store.id, row.id, { status: 'conflict', error: 'conflict' });
      return fail(c, 409, '別の担当者が先に変更しています。最新の内容を確認してから、もう一度やり直してください', {
        code: 'conflict',
        current,
        change: publicChange((await changeFor(c, store.id, row.id))!),
      });
    }
  }

  const requestId = crypto.randomUUID();
  await updateChange(c, store.id, row.id, { status: 'pending_confirm', requestId, sentAt: nowIso() });
  try {
    if (row.kind === 'photo') {
      const after = parseJson<{ action: 'add' | 'delete'; sourceUrl?: string; mediaName?: string }>(row.after_json, { action: 'add' });
      if (after.action === 'add' && after.sourceUrl) await createMedia(options, connection.location_name!, after.sourceUrl);
      else if (after.action === 'delete' && after.mediaName) await deleteMedia(options, after.mediaName);
      else throw new Error('unsupported_change');
      await updateChange(c, store.id, row.id, { status: 'applied', appliedAt: nowIso() });
    } else {
      const patch = buildSendPatch(latest, row);
      const updated = await patchProfile(options, connection.location_name!, patch);
      await saveProfile(c, store.id, connection.location_name!, updated);
      const applied = canonical(sliceOf(updated, row)) === canonical(expectedSlice(row));
      await updateChange(c, store.id, row.id, { status: applied ? 'applied' : 'accepted', appliedAt: applied ? nowIso() : null });
    }
    auditLog(c, 'restaurant.google.change.send', { id: row.id, kind: 'rt_google_change' }, { lineAccountId: store.lineAccountId });
    return c.json({ success: true, alreadyApplied: false, change: publicChange((await changeFor(c, store.id, row.id))!) });
  } catch (error) {
    const kind = error instanceof GoogleBusinessError ? error.kind : 'unknown';
    // 通信結果が不明（ネットワーク断・5xx）なら pending_confirm のまま残し、次回は最新と照合してから再送する。
    const unknownResult = kind === 'unavailable' || kind === 'unknown';
    const detail = error instanceof GoogleBusinessError && error.message && !error.message.startsWith('google_') ? error.message : null;
    if (!unknownResult) await updateChange(c, store.id, row.id, { status: 'failed', error: detail ?? kind });
    auditLog(c, 'restaurant.google.change.send', { id: row.id, kind: 'rt_google_change' }, { result: 'failed', lineAccountId: store.lineAccountId });
    if (kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    if (kind === 'invalid_request') {
      return fail(c, 400, `Googleに受け付けられない内容です${detail ? `（${detail}）` : ''}`, {
        code: 'invalid_request',
        change: publicChange((await changeFor(c, store.id, row.id))!),
      });
    }
    return googleErrorResponse(c, error);
  }
});
