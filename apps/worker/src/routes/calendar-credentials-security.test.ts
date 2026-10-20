import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createCalendarConnection, createCalendarBooking, encryptCredential, decryptCredential } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: async () => ({ allowedAccountIds: ['account-a'], canSeeUnassigned: false }),
}));
const google = vi.hoisted(() => ({ getFreeBusy: vi.fn(async () => []), createEvent: vi.fn(), deleteEvent: vi.fn() }));
vi.mock('../services/google-calendar.js', () => ({ GoogleCalendarClient: vi.fn(function () { return google; }) }));
import { GoogleCalendarClient } from '../services/google-calendar.js';
import { calendar } from './calendar.js';

// Generated fixtures only. No real credentials or external requests.
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const scope = { allowedAccountIds: ['account-a'], includeUnassigned: false };
const opened: ReturnType<typeof createTestD1>[] = [];
function fixture() {
  const db = createTestD1({ foreignKeys: false });
  opened.push(db);
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-a', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', calendar);
  return { ...db, app };
}
afterEach(() => { opened.splice(0).forEach(db => db.raw.close()); vi.clearAllMocks(); });

describe('S21 calendar credentials at rest and at Google boundary', () => {
  it('encrypts all three credentials before D1 receives them, with fresh IVs', async () => {
    const db = fixture();
    const input = { calendarId: 'fixture-calendar', authType: 'oauth', lineAccountId: 'account-a',
      accessToken: 'fixture-access', refreshToken: 'fixture-refresh', apiKey: 'fixture-api-key' };
    for (let i = 0; i < 2; i++) {
      await createCalendarConnection(db.db, input, scope, key);
    }
    const rows = db.raw.prepare('SELECT access_token, refresh_token, api_key FROM google_calendar_connections').all() as Record<string, string>[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const [column, plain] of [['access_token', input.accessToken], ['refresh_token', input.refreshToken], ['api_key', input.apiKey]]) {
        expect(row[column]).toMatch(/^v1\./);
        expect(await decryptCredential(row[column], key)).toBe(plain);
      }
    }
    expect(rows[0].access_token).not.toBe(rows[1].access_token);
  });

  it.each([undefined, 'invalid'])('rejects missing/invalid keys before writing: %s', async encryptionKey => {
    const db = fixture();
    await expect(createCalendarConnection(db.db, { calendarId: 'fixture-calendar', authType: 'oauth',
      lineAccountId: 'account-a', accessToken: 'fixture-access' }, scope, encryptionKey)).rejects.toThrow();
    expect(db.raw.prepare('SELECT count(*) AS n FROM google_calendar_connections').get()).toEqual({ n: 0 });
  });

  it('decrypts only for Google, and never includes credentials in API responses', async () => {
    const db = fixture();
    const response = await db.app.request('/api/integrations/google-calendar/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', calendarId: 'fixture-calendar', authType: 'oauth', accessToken: 'fixture-access' }),
    }, { DB: db.db, GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY: key });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { id: string } };
    expect(JSON.stringify(body)).not.toContain('fixture-access');
    const slots = await db.app.request(`/api/integrations/google-calendar/slots?connectionId=${body.data.id}&date=2026-10-20`, {},
      { DB: db.db, GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY: key });
    expect(slots.status).toBe(200);
    expect(GoogleCalendarClient).toHaveBeenCalledWith({ calendarId: 'fixture-calendar', accessToken: 'fixture-access' });
  });

  it.each(['fixture-legacy-plaintext', 'v1.invalid.invalid'])('fails closed on plaintext/tampering without calling Google: %s', async payload => {
    const db = fixture();
    db.raw.prepare(`INSERT INTO google_calendar_connections (id,calendar_id,line_account_id,auth_type,access_token)
      VALUES ('legacy','fixture-calendar','account-a','oauth',?)`).run(payload);
    const response = await db.app.request('/api/integrations/google-calendar/slots?connectionId=legacy&date=2026-10-20', {},
      { DB: db.db, GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY: key });
    expect(response.status).toBe(500);
    expect(GoogleCalendarClient).not.toHaveBeenCalled();
  });

  it.each(['tamper', 'wrong-key'])('rejects authenticated ciphertext after %s', async failure => {
    const db = fixture();
    const encrypted = await encryptCredential('fixture-access', key);
    const parts = encrypted.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    db.raw.prepare(`INSERT INTO google_calendar_connections (id,calendar_id,line_account_id,auth_type,access_token)
      VALUES ('damaged','fixture-calendar','account-a','oauth',?)`).run(failure === 'tamper' ? parts.join('.') : encrypted);
    const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
    const response = await db.app.request('/api/integrations/google-calendar/slots?connectionId=damaged&date=2026-10-20', {},
      { DB: db.db, GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY: failure === 'tamper' ? key : otherKey });
    expect(response.status).toBe(500);
    expect(GoogleCalendarClient).not.toHaveBeenCalled();
  });

  it.each(['create', 'cancel'])('legacy plaintext stops booking %s before any state changes', async operation => {
    const db = fixture();
    db.raw.prepare(`INSERT INTO google_calendar_connections (id,calendar_id,line_account_id,auth_type,access_token)
      VALUES ('legacy','fixture-calendar','account-a','oauth','fixture-legacy-plaintext')`).run();
    const booking = await createCalendarBooking(db.db, { connectionId: 'legacy', eventId: 'fixture-event',
      title: 'Fixture', startAt: '2026-10-20T10:00:00+09:00', endAt: '2026-10-20T11:00:00+09:00' }, scope);
    const response = await db.app.request(operation === 'create'
      ? '/api/integrations/google-calendar/book' : `/api/integrations/google-calendar/bookings/${booking!.id}/status`, {
      method: operation === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation === 'create'
        ? { connectionId: 'legacy', title: 'Fixture', startAt: '2026-10-21T10:00:00+09:00', endAt: '2026-10-21T11:00:00+09:00' }
        : { status: 'cancelled' }),
    }, { DB: db.db, GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY: key });
    expect(response.status).toBe(500);
    expect(db.raw.prepare('SELECT status FROM calendar_bookings').all()).toEqual([{ status: 'confirmed' }]);
    expect(GoogleCalendarClient).not.toHaveBeenCalled();
  });
});
