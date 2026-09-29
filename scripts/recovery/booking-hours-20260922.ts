// One incident, one staging account. No arbitrary SQL/target input; no local credentials.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TARGET = Object.freeze({
  repository: 'skmtmst/line-harness-oss',
  account: '55f40f5577bd68828d67716f8d900642',
  database: '00bd7aca-950b-4d67-b865-fd7427b9c43f',
  databaseName: 'nen-line-stg',
  lineAccount: 'b9dac3d2-b9a7-44b8-bdcf-6d466fd3fb51',
  confirmation: 'RESTORE-20260922-TEST-HOURS',
});
type Value = string | number | null;
type Row = Record<string, Value>;
export type Query = { sql: string; params?: Value[] };
export type Snapshot = { settings: Row[]; hours: Row[]; schema: Row[] };
type Batch = (queries: Query[]) => Promise<Row[][]>;

const SETTINGS = ['id', 'line_account_id', 'timezone', 'booking_window_days',
  'cutoff_minutes_before', 'cancel_deadline_minutes_before', 'max_active_bookings_per_friend',
  'approval_mode', 'hold_minutes', 'slot_granularity_minutes', 'version', 'created_at',
  'updated_at', 'reminder_day_before_time', 'reminder_hours_before', 'business_hours_configured'];
const HOURS = ['id', 'booking_settings_id', 'weekday', 'start_time', 'end_time', 'capacity', 'created_at'];
const SCHEMA = ['type', 'name', 'tbl_name', 'sql'];
const TABLES = "('booking_settings', 'booking_business_hours')";
const fail = (message: string): never => { throw new Error(message); };
const check = (ok: unknown, message: string): void => { if (!ok) fail(message); };
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const reads: Query[] = [
  { sql: `SELECT ${SETTINGS.join(', ')} FROM booking_settings WHERE line_account_id = ?`, params: [TARGET.lineAccount] },
  { sql: `SELECT ${HOURS.map(c => `bh.${c}`).join(', ')} FROM booking_business_hours bh
    JOIN booking_settings bs ON bs.id = bh.booking_settings_id WHERE bs.line_account_id = ? ORDER BY bh.id`, params: [TARGET.lineAccount] },
  { sql: `SELECT ${SCHEMA.join(', ')} FROM sqlite_schema WHERE tbl_name IN ${TABLES} ORDER BY type, name` },
];
export const snapshotFrom = (rows: Row[][]): Snapshot => {
  check(rows.length === 3 && rows.every(Array.isArray), 'Unexpected snapshot response');
  return { settings: rows[0]!, hours: rows[1]!, schema: rows[2]! };
};
// Canonical field order, not HTTP JSON property order. Only known, non-customer fields.
export function digest(snapshot: Snapshot): string {
  const values = [snapshot.settings.map(r => SETTINGS.map(c => r[c])),
    snapshot.hours.map(r => HOURS.map(c => r[c])), snapshot.schema.map(r => SCHEMA.map(c => r[c]))];
  return createHash('sha256').update(JSON.stringify([TARGET, values])).digest('hex');
}
export function validate(snapshot: Snapshot): void {
  check(snapshot.settings.length === 1 && snapshot.hours.length === 1, 'Expected exactly one setting and one accidental interval; stop (also on rerun)');
  const s = snapshot.settings[0]!;
  const h = snapshot.hours[0]!;
  check(SETTINGS.every(c => c in s) && HOURS.every(c => c in h), 'Incomplete backup');
  check(s.line_account_id === TARGET.lineAccount && s.business_hours_configured === 1, 'Wrong account or configuration state');
  check(Number.isSafeInteger(s.version) && Number(s.version) > 0 && Number(s.version) < Number.MAX_SAFE_INTEGER, 'Invalid version');
  check(typeof s.id === 'string' && s.id.length > 0 && typeof h.id === 'string' && h.id.length > 0, 'Missing row identity');
  check(h.booking_settings_id === s.id && h.weekday === 1 && h.start_time === '09:00' && h.end_time === '18:00' && h.capacity === 1, 'Interval differs from incident');
  const baseline: Row = { timezone: 'Asia/Tokyo', booking_window_days: 60, cutoff_minutes_before: 1440,
    cancel_deadline_minutes_before: 1440, max_active_bookings_per_friend: 1, approval_mode: 'automatic',
    hold_minutes: 15, slot_granularity_minutes: 15, reminder_day_before_time: null, reminder_hours_before: 2 };
  check(Object.entries(baseline).every(([k, v]) => s[k] === v), 'Other settings differ from recorded incident');
  // jstNow() has an offset; the hours table's SQLite default is JST without an offset.
  const incidentTime = (value: Value | undefined): number => {
    check(typeof value === 'string' && /^2026-09-22T03:2[0-4]:\d{2}\.\d{3}(\+09:00)?$/.test(value), 'Timestamp is outside the recorded incident window');
    return Date.parse(String(value).endsWith('+09:00') ? String(value) : `${value}+09:00`);
  };
  check(Math.abs(incidentTime(s.updated_at) - incidentTime(h.created_at)) < 60_000, 'Interval and settings were not saved together');
  check(snapshot.schema.filter(r => r.type === 'table').length === 2 && snapshot.schema.every(r => r.type !== 'trigger'), 'Unexpected schema or trigger; manual investigation required');
}

// IS preserves NULL equality. Identifiers come only from the fixed lists above.
function predicate(columns: string[], row: Row, params: Value[]): string {
  params.push(...columns.map(c => row[c]!));
  return columns.map(c => `${c} IS ?`).join(' AND ');
}
function guard(condition: string, params: Value[]): Query {
  // SQLite CASE is lazy: invalid JSON intentionally aborts the whole D1 batch on mismatch.
  return { sql: `SELECT json(CASE WHEN ${condition} THEN '{}' ELSE 'RECOVERY_GUARD_FAILED' END) AS guard`, params };
}
export function repairBatch(snapshot: Snapshot, updatedAt: string): Query[] {
  validate(snapshot);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/.test(updatedAt) && Date.parse(updatedAt) > Date.parse(String(snapshot.settings[0]!.updated_at)), 'Invalid recovery timestamp');
  const s = snapshot.settings[0]!;
  const h = snapshot.hours[0]!;
  const params: Value[] = [];
  const checks = [
    `(SELECT COUNT(*) FROM booking_settings WHERE ${predicate(SETTINGS, s, params)}) = 1`,
    `(SELECT COUNT(*) FROM booking_business_hours WHERE ${predicate(HOURS, h, params)}) = 1`,
    `(SELECT COUNT(*) FROM booking_business_hours WHERE booking_settings_id = ?) = 1`,
  ];
  params.push(s.id!);
  checks.push(`(SELECT COUNT(*) FROM sqlite_schema WHERE tbl_name IN ${TABLES}) = ?`);
  params.push(snapshot.schema.length);
  for (const row of snapshot.schema) checks.push(`EXISTS (SELECT 1 FROM sqlite_schema WHERE ${predicate(SCHEMA, row, params)})`);
  return [
    guard(checks.join(' AND '), params),
    { sql: 'DELETE FROM booking_business_hours WHERE id = ? AND booking_settings_id = ?', params: [h.id!, s.id!] },
    guard('changes() = 1', []),
    { sql: `UPDATE booking_settings SET business_hours_configured = 0, version = version + 1, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND version = ?`, params: [updatedAt, s.id!, TARGET.lineAccount, s.version!] },
    guard('changes() = 1', []),
    ...reads,
  ];
}
export function verify(before: Snapshot, after: Snapshot, updatedAt: string): void {
  const expected = { ...before.settings[0], business_hours_configured: 0, version: Number(before.settings[0]!.version) + 1, updated_at: updatedAt };
  check(after.settings.length === 1 && after.hours.length === 0 && SETTINGS.every(c => expected[c as keyof typeof expected] === after.settings[0]![c]) && equal(before.schema, after.schema), 'Post-recovery verification failed; DO NOT retry writes');
}

export function assertContext(env: NodeJS.ProcessEnv, now: Date): void {
  check(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === TARGET.repository && env.GITHUB_REF === 'refs/heads/codex/development', 'Only the approved development workflow can run this recovery');
  check(env.GITHUB_WORKFLOW_REF === `${TARGET.repository}/.github/workflows/migrate-d1.yml@refs/heads/codex/development`, 'Unexpected workflow');
  check(env.RECOVERY_ENVIRONMENT === 'staging' && env.CLOUDFLARE_ACCOUNT_ID === TARGET.account && Boolean(env.CLOUDFLARE_API_TOKEN), 'Wrong environment/account or missing credential');
  check(now >= new Date('2026-09-22T00:00:00+09:00') && now < new Date('2026-09-29T00:00:00+09:00'), 'One-off recovery window has expired');
  check(env.RECOVERY_MODE === 'dry-run' || env.RECOVERY_MODE === 'apply', 'Unknown mode');
  if (env.RECOVERY_MODE === 'apply') check(env.RECOVERY_CONFIRMATION === TARGET.confirmation && /^[a-f0-9]{64}$/.test(env.RECOVERY_DIGEST ?? ''), 'Apply requires exact confirmation and preflight digest');
}

export function makeClient(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${TARGET.account}/d1/database/${TARGET.database}`;
  async function request(path: string, body?: unknown): Promise<unknown> {
    // No retry, redirects, arbitrary URL, response-body logging, or local token persistence.
    const response = await fetcher(base + path, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    check(response.ok, `D1 request failed (HTTP ${response.status}); inspect state before any retry`);
    const data = await response.json() as { success?: boolean; result?: unknown };
    check(data.success === true && data.result !== undefined, 'D1 returned an unsuccessful response; inspect state before any retry');
    return data.result;
  }
  return {
    async identity() {
      const data = await request('') as { uuid?: string; name?: string };
      check(data.uuid === TARGET.database && data.name === TARGET.databaseName, 'D1 identity mismatch');
    },
    async batch(queries: Query[]): Promise<Row[][]> {
      const data = await request('/query', { batch: queries }) as { success?: boolean; results?: Row[] }[];
      check(Array.isArray(data) && data.length === queries.length && data.every(r => r.success === true && Array.isArray(r.results)), 'D1 batch failed or is incomplete; DO NOT retry writes');
      return data.map(r => r.results!);
    },
  };
}

export async function applyOnce(batch: Batch, before: Snapshot, expectedDigest: string, updatedAt: string): Promise<Snapshot> {
  validate(before);
  check(digest(before) === expectedDigest, 'Backup differs from approved preflight');
  const current = snapshotFrom(await batch(reads));
  check(digest(current) === expectedDigest, 'Data changed since preflight; no write performed');
  // One request: guard, both writes and verification reads share the D1 transaction.
  const result = await batch(repairBatch(before, updatedAt));
  const after = snapshotFrom(result.slice(-3));
  verify(before, after, updatedAt);
  const reread = snapshotFrom(await batch(reads));
  verify(before, reread, updatedAt);
  return reread;
}

async function main(): Promise<void> {
  const env = process.env;
  assertContext(env, new Date());
  const command = process.argv[2];
  check(command === 'capture' || command === 'apply', 'Use capture or apply');
  check(Boolean(env.RECOVERY_BACKUP) && Boolean(env.GITHUB_STEP_SUMMARY), 'Missing artifact/summary path');
  const client = makeClient(env);
  await client.identity();
  if (command === 'capture') {
    const before = snapshotFrom(await client.batch(reads));
    validate(before);
    const hash = digest(before);
    if (env.RECOVERY_MODE === 'apply') check(hash === env.RECOVERY_DIGEST, 'State differs from approved preflight; no write performed');
    writeFileSync(env.RECOVERY_BACKUP!, JSON.stringify({ incident: '20260922-booking-hours', target: TARGET, sha: env.GITHUB_SHA, capturedAt: new Date().toISOString(), digest: hash, before }, null, 2), { flag: 'wx', mode: 0o600 });
    appendFileSync(env.GITHUB_STEP_SUMMARY!, `\n## 営業時間の復旧・事前検査\n\n対象: 検証用 TEST 1件。変更なし。\n\n事前検査の照合値: \`${hash}\`\n\n版: ${before.settings[0]!.version} / 事故時刻: ${before.settings[0]!.updated_at}\n`);
    return;
  }
  check(env.RECOVERY_MODE === 'apply' && /^\d+$/.test(env.RECOVERY_ARTIFACT_ID ?? ''), 'Apply requires a successfully uploaded backup artifact');
  const backup = JSON.parse(readFileSync(env.RECOVERY_BACKUP!, 'utf8')) as { target: unknown; digest: string; before: Snapshot; sha: string; capturedAt: string };
  check(equal(backup.target, TARGET) && backup.sha === env.GITHUB_SHA && backup.digest === env.RECOVERY_DIGEST, 'Backup identity or digest mismatch');
  const age = Date.now() - Date.parse(backup.capturedAt);
  check(age >= 0 && age < 15 * 60_000, 'Backup is stale');
  const now = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, -1) + '+09:00';
  await applyOnce(client.batch, backup.before, backup.digest, now);
  appendFileSync(env.GITHUB_STEP_SUMMARY!, `\n## 復旧後の照合\n\n対象1件を未設定に復元。その他の設定値は保持、版は +1。\n\n復旧前バックアップ: artifact ${env.RECOVERY_ARTIFACT_ID}\n\n実画面の再確認は別途必要です。\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // API/transport errors can contain request details; never dump them or retry a write.
    console.error('営業時間の復旧処理を停止しました。書込の自動再試行はしません。事前検査/保存済みバックアップと現在値を読み取りで照合してください。');
    process.exitCode = 1;
  });
}
