import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { gapFixture } from '../../test-utils/gap1.js';
import type { SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { GoogleCalendarClient, GoogleCalendarReadError, type GoogleCalendarConfig } from '../../services/google-calendar.js';
import * as featureEnforcement from '../../services/feature-enforcement.js';
import { refreshCalendarBusyCaches } from './booking-calendar-settings.js';

let d: SqliteD1;
let visited: string[];
const currentCalendar = (client: GoogleCalendarClient) =>
  (client as unknown as { config: GoogleCalendarConfig }).config.calendarId;

function connections(account: string, count: number, prefix = account) {
  d.raw.prepare("INSERT INTO booking_calendar_switches(line_account_id,scope_id,read_enabled,updated_by,updated_at) VALUES(?,?,1,'synthetic','2026-10-23T00:00:00Z')").run(account, '');
  const connect = d.raw.prepare(`INSERT INTO google_calendar_connections(id,line_account_id,staff_id,calendar_id,auth_type,access_token,is_active)
    VALUES(?,?,?,?,'oauth','synthetic-token',1)`);
  const enabled = d.raw.prepare("INSERT INTO booking_calendar_switches(line_account_id,scope_id,read_enabled,updated_by,updated_at) VALUES(?,?,1,'synthetic','2026-10-23T00:00:00Z')");
  d.raw.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `${prefix}-${String(i).padStart(4, '0')}`;
      connect.run(id, account, id, id);
      enabled.run(account, id);
    }
  })();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
  d = gapFixture();
  visited = [];
  vi.spyOn(GoogleCalendarClient.prototype, 'getTimedBusy').mockImplementation(async function (this: GoogleCalendarClient) {
    visited.push(currentCalendar(this));
    return [];
  });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unexpected_external_request'); }));
});
afterEach(() => {
  d.raw.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('151 connections rotate beyond the first 100 even when every earlier connection fails', async () => {
  connections('a', 151);
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockImplementation(async function (this: GoogleCalendarClient) {
    const id = currentCalendar(this);
    visited.push(id);
    if (id < 'a-0100') throw new GoogleCalendarReadError(503);
    return [];
  });
  await refreshCalendarBusyCaches(d.db, {}, new Date());
  expect(visited).toEqual(Array.from({ length: 100 }, (_, i) => `a-${String(i).padStart(4, '0')}`));
  expect(d.raw.prepare('SELECT COUNT(*) n FROM booking_calendar_busy_cache').get()).toEqual({ n: 0 });
  vi.advanceTimersByTime(5 * 60_000);
  await refreshCalendarBusyCaches(d.db, {}, new Date());
  expect(visited.slice(100, 151)).toEqual(Array.from({ length: 51 }, (_, i) => `a-${String(i + 100).padStart(4, '0')}`));
  expect(new Set(visited).size).toBe(151);
  expect(visited).toHaveLength(200);
  // Failed reads do not fabricate freshness; last_success_at and the first failure keep their meaning.
  expect(d.raw.prepare("SELECT last_success_at,failed_since FROM booking_calendar_read_health WHERE staff_id='a-0000'").get())
    .toEqual({ last_success_at: null, failed_since: '2026-10-23T00:00:00.000Z' });
});

test('account-scoped continuations process one connection at a time, reach all 62 once per window, and cannot read another tenant', async () => {
  connections('a', 62);
  connections('b', 30, '0-other');
  const attemptedBefore = new Date().toISOString();
  for (let i = 0; i < 62; i++) {
    expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore }))
      .toEqual({ processed: 1, hasMore: i < 61 });
    expect(visited).toHaveLength(i + 1);
  }
  expect(new Set(visited).size).toBe(62);
  expect(visited.every(id => id.startsWith('a-'))).toBe(true);
  expect(d.raw.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'calendar-busy-attempt:0-other%'").get()).toEqual({ n: 0 });
  const reads = visited.length;
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore }))
    .toEqual({ processed: 0, hasMore: false });
  await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: '' });
  expect(visited).toHaveLength(reads);
});

test('fresh manually read caches run after older or never attempted connections', async () => {
  connections('a', 26);
  d.raw.exec(`INSERT INTO booking_calendar_busy_cache(line_account_id,staff_id,connection_id,calendar_id,time_min,time_max,busy_json,last_read_at)
    VALUES('a','a-0000','a-0000','a-0000','2026-10-22T00:00:00Z','2026-12-22T00:00:00Z','[]','2026-10-23T00:00:00Z')`);
  await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a' });
  expect(visited).toEqual(['a-0001']);
  expect(visited).not.toContain('a-0000');
});

test('a failing or disabled feature gate advances its attempt and does not block later accounts', async () => {
  connections('a', 100);
  connections('b', 1);
  const canRun = vi.fn(async (_db: D1Database, account: string | null) => {
    if (account === 'a') throw new Error('synthetic_feature_lookup_failure');
    return true;
  });
  vi.spyOn(featureEnforcement, 'createFeatureJobGate').mockReturnValue({ canRun });
  await expect(refreshCalendarBusyCaches(d.db, {}, new Date())).resolves.toEqual({ processed: 100, hasMore: true });
  expect(visited).toEqual([]);
  expect(d.raw.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'calendar-busy-attempt:%'").get()).toEqual({ n: 100 });
  vi.advanceTimersByTime(5 * 60_000);
  canRun.mockImplementation(async (_db, account) => account !== 'a');
  await refreshCalendarBusyCaches(d.db, {}, new Date());
  expect(visited).toEqual(['b-0000']);
});

test('a 50-second deadline aborts five in-flight reads and leaves unstarted connections eligible', async () => {
  connections('a', 30);
  let active = 0;
  let maximum = 0;
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockImplementation(function (this: GoogleCalendarClient, _min, _max, signal) {
    visited.push(currentCalendar(this));
    active++;
    maximum = Math.max(maximum, active);
    return new Promise((_, reject) => {
      const abort = () => { active--; reject(new Error('synthetic_abort')); };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  });
  const work = refreshCalendarBusyCaches(d.db, {}, new Date());
  await vi.advanceTimersByTimeAsync(49_999);
  expect(visited).toHaveLength(5);
  expect(active).toBe(5);
  await vi.advanceTimersByTimeAsync(1);
  expect(await work).toEqual({ processed: 5, hasMore: true });
  expect(active).toBe(0);
  expect(maximum).toBe(5);
  expect(visited).toHaveLength(5);
  expect(d.raw.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'calendar-busy-attempt:%'").get()).toEqual({ n: 5 });
  expect(d.raw.prepare('SELECT COUNT(*) n FROM booking_calendar_busy_cache').get()).toEqual({ n: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

test('the Google read transport observes cancellation and does not start another page', async () => {
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockRestore();
  const controller = new AbortController();
  const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('synthetic_abort')), { once: true });
    });
  });
  const client = new GoogleCalendarClient({ calendarId: 'synthetic', accessToken: 'synthetic-token', transport });
  const work = client.getTimedBusy('2026-10-23T00:00:00Z', '2026-10-24T00:00:00Z', controller.signal);
  const rejected = expect(work).rejects.toThrow();
  controller.abort();
  await rejected;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  await expect(client.getTimedBusy('2026-10-23T00:00:00Z', '2026-10-24T00:00:00Z', controller.signal)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

test('a scoped one-page read fits the D1 invocation budget with real circuit persistence and mocked HTTP', async () => {
  connections('a', 26);
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockRestore();
  const prepare = vi.spyOn(d.db, 'prepare');
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ items: [] })));
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a' })).toEqual({ processed: 1, hasMore: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls.length).toBeLessThan(1_000);
  expect(d.raw.prepare('SELECT COUNT(*) n FROM booking_calendar_busy_cache').get()).toEqual({ n: 1 });
  process.stdout.write(`${JSON.stringify({ benchmark: 'calendar-account-refresh', connections: 1, pagesEach: 1, sql: prepare.mock.calls.length })}\n`);
});

test('an exhausted 100-page Google response fails closed instead of saving partial availability', async () => {
  connections('a', 1);
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockRestore();
  const prepare = vi.spyOn(d.db, 'prepare');
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ items: [], nextPageToken: 'synthetic-next' })));
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: new Date().toISOString() }))
    .toEqual({ processed: 1, hasMore: false });
  expect(fetch).toHaveBeenCalledTimes(100);
  expect(d.raw.prepare('SELECT COUNT(*) n FROM booking_calendar_busy_cache').get()).toEqual({ n: 0 });
  expect(d.raw.prepare('SELECT error_code FROM booking_calendar_read_health').get()).toEqual({ error_code: 'calendar_unavailable' });
  expect(prepare.mock.calls.length).toBeLessThan(1_000);
  process.stdout.write(`${JSON.stringify({ benchmark: 'calendar-pagination-exhausted', connections: 1, pagesEach: 100, sql: prepare.mock.calls.length })}\n`);
});

test('failed reads advance the same-window continuation without pretending the cache was refreshed', async () => {
  connections('a', 3);
  const attemptedBefore = new Date().toISOString();
  vi.mocked(GoogleCalendarClient.prototype.getTimedBusy).mockImplementation(async function (this: GoogleCalendarClient) {
    visited.push(currentCalendar(this));
    throw new GoogleCalendarReadError(503);
  });
  for (let i = 0; i < 3; i++) {
    expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore }))
      .toEqual({ processed: 1, hasMore: i < 2 });
  }
  expect(visited).toEqual(['a-0000', 'a-0001', 'a-0002']);
  expect(d.raw.prepare('SELECT COUNT(*) n FROM booking_calendar_busy_cache').get()).toEqual({ n: 0 });
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore }))
    .toEqual({ processed: 0, hasMore: false });
  vi.advanceTimersByTime(5 * 60_000);
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: new Date().toISOString() }))
    .toEqual({ processed: 1, hasMore: true });
  expect(visited.at(-1)).toBe('a-0000');
});

test('a current-window manual read is excluded and an invalid boundary fails without reading calendars', async () => {
  connections('a', 1);
  d.raw.exec(`INSERT INTO booking_calendar_busy_cache(line_account_id,staff_id,connection_id,calendar_id,time_min,time_max,busy_json,last_read_at)
    VALUES('a','a-0000','a-0000','a-0000','2026-10-22T00:00:00Z','2026-12-22T00:00:00Z','[]','2026-10-23T00:00:00Z')`);
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: new Date().toISOString() }))
    .toEqual({ processed: 0, hasMore: false });
  await expect(refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: 'invalid' }))
    .rejects.toThrow('calendar_refresh_boundary_invalid');
  expect(visited).toEqual([]);
});

test('failed attempt persistence reports no progress and does not call Google', async () => {
  connections('a', 1);
  d.raw.exec(`CREATE TRIGGER fail_calendar_attempt BEFORE INSERT ON platform_settings
    WHEN NEW.key LIKE 'calendar-busy-attempt:%' BEGIN SELECT RAISE(FAIL,'synthetic_attempt_failure'); END`);
  expect(await refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: new Date().toISOString() }))
    .toEqual({ processed: 0, hasMore: true });
  expect(visited).toEqual([]);
});

test('selection that outlasts the deadline leaves the connection unattempted with zero progress', async () => {
  connections('a', 1);
  const prepare = d.db.prepare.bind(d.db);
  vi.spyOn(d.db, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT g.id,g.line_account_id')) return statement;
    return {
      ...statement,
      bind(...values: unknown[]) {
        const bound = statement.bind(...values);
        return {
          ...bound,
          async all<T>() {
            const result = await bound.all<T>();
            await new Promise(resolve => setTimeout(resolve, 50_001));
            return result;
          },
        };
      },
    } as D1PreparedStatement;
  });
  const work = refreshCalendarBusyCaches(d.db, {}, new Date(), { accountId: 'a', attemptedBefore: new Date().toISOString() });
  await vi.advanceTimersByTimeAsync(50_001);
  expect(await work).toEqual({ processed: 0, hasMore: true });
  expect(visited).toEqual([]);
  expect(d.raw.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'calendar-busy-attempt:%'").get()).toEqual({ n: 0 });
});
