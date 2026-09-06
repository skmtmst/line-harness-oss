import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const db = vi.hoisted(() => ({
  getCalendarConnections: vi.fn(),
  getCalendarConnectionById: vi.fn(),
  createCalendarConnection: vi.fn(),
  deleteCalendarConnection: vi.fn(),
  getCalendarBookings: vi.fn(),
  getCalendarBookingById: vi.fn(),
  createCalendarBooking: vi.fn(),
  updateCalendarBookingStatus: vi.fn(),
  updateCalendarBookingEventId: vi.fn(),
  getBookingsInRange: vi.fn(),
  getFriendById: vi.fn(),
}));
const accountAccess = vi.hoisted(() => ({ getVisibleLineAccountScope: vi.fn() }));
const google = vi.hoisted(() => ({
  getFreeBusy: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  ...db,
  toJstString: vi.fn((date: Date) => date.toISOString()),
}));
vi.mock('../services/account-access.js', () => accountAccess);
vi.mock('../services/google-calendar.js', () => ({
  GoogleCalendarClient: vi.fn(() => google),
}));

const { calendar } = await import('./calendar.js');

type Role = 'owner' | 'admin' | 'staff';
const env = { DB: {} as D1Database };
const OWN_SCOPE = { allowedAccountIds: ['account-a'], includeUnassigned: false };
const CONNECTION_A = {
  id: 'connection-a',
  calendar_id: 'calendar-a@example.com',
  line_account_id: 'account-a',
  staff_id: null,
  access_token: null,
  refresh_token: null,
  api_key: null,
  auth_type: 'oauth',
  is_active: 1,
  last_verified_at: null,
  last_error: null,
  created_at: '2026-09-07T00:00:00+09:00',
  updated_at: '2026-09-07T00:00:00+09:00',
};
const BOOKING_A = {
  id: 'booking-a',
  connection_id: 'connection-a',
  friend_id: 'friend-a',
  event_id: null,
  title: '面談',
  start_at: '2026-09-08T10:00:00+09:00',
  end_at: '2026-09-08T11:00:00+09:00',
  status: 'confirmed',
  metadata: null,
  created_at: '2026-09-07T00:00:00+09:00',
  updated_at: '2026-09-07T00:00:00+09:00',
};

function makeApp(role: Role = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: role === 'staff' ? 'staff-a' : 'owner-a',
      name: '担当者',
      role,
      readOnly: false,
      tenantId: 'tenant-a',
    });
    return next();
  });
  app.route('/', calendar);
  return app;
}

function request(path: string, init?: RequestInit, role?: Role) {
  return makeApp(role).request(`https://example.com${path}`, init, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-a', tenant_id: 'tenant-a' }],
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: false,
    ids: ['account-a'],
  });
  db.getCalendarConnections.mockResolvedValue([CONNECTION_A]);
  db.getCalendarConnectionById.mockResolvedValue(CONNECTION_A);
  db.createCalendarConnection.mockResolvedValue(CONNECTION_A);
  db.deleteCalendarConnection.mockResolvedValue(true);
  db.getCalendarBookings.mockResolvedValue([BOOKING_A]);
  db.getCalendarBookingById.mockResolvedValue(BOOKING_A);
  db.createCalendarBooking.mockResolvedValue({ ...BOOKING_A });
  db.updateCalendarBookingStatus.mockResolvedValue(true);
  db.updateCalendarBookingEventId.mockResolvedValue(true);
  db.getBookingsInRange.mockResolvedValue([]);
  db.getFriendById.mockResolvedValue({ id: 'friend-a', line_account_id: 'account-a' });
  google.getFreeBusy.mockResolvedValue([]);
  google.createEvent.mockResolvedValue({ eventId: 'event-a' });
  google.deleteEvent.mockResolvedValue(undefined);
});

describe('Google Calendar role boundary', () => {
  it.each([
    ['GET', '/api/integrations/google-calendar', undefined],
    ['POST', '/api/integrations/google-calendar/connect', { accountId: 'account-a', calendarId: 'calendar-a', authType: 'oauth' }],
    ['DELETE', '/api/integrations/google-calendar/connection-a', undefined],
    ['GET', '/api/integrations/google-calendar/slots?connectionId=connection-a&date=2026-09-08', undefined],
    ['GET', '/api/integrations/google-calendar/bookings', undefined],
    ['POST', '/api/integrations/google-calendar/book', { connectionId: 'connection-a', title: '面談', startAt: BOOKING_A.start_at, endAt: BOOKING_A.end_at }],
    ['PUT', '/api/integrations/google-calendar/bookings/booking-a/status', { status: 'cancelled' }],
  ] as const)('staff cannot call %s %s', async (method, path, body) => {
    const response = await request(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }, 'staff');

    expect(response.status).toBe(403);
    expect(accountAccess.getVisibleLineAccountScope).not.toHaveBeenCalled();
  });
});

describe('Google Calendar tenant and account boundary', () => {
  it('passes only the accounts visible inside the signed-in tenant to list queries', async () => {
    const response = await request('/api/integrations/google-calendar');

    expect(response.status).toBe(200);
    expect(db.getCalendarConnections).toHaveBeenCalledWith(env.DB, OWN_SCOPE);
    expect(await response.json()).toMatchObject({ success: true, data: [{ id: 'connection-a' }] });
  });

  it('rejects connection creation for an account outside the resolved scope', async () => {
    const response = await request('/api/integrations/google-calendar/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-b', calendarId: 'calendar-b', authType: 'oauth' }),
    });

    expect(response.status).toBe(403);
    expect(db.createCalendarConnection).not.toHaveBeenCalled();
  });

  it('binds an allowed new connection to the selected account', async () => {
    const response = await request('/api/integrations/google-calendar/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-a',
        calendarId: 'calendar-a',
        authType: 'oauth',
        lineAccountId: 'account-b',
        staffId: 'attacker-controlled',
      }),
    }, 'admin');

    expect(response.status).toBe(201);
    expect(db.createCalendarConnection).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-a',
      calendarId: 'calendar-a',
    }), OWN_SCOPE);
    const input = db.createCalendarConnection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('staffId');
  });

  it('returns 404 before reading slots for a connection in another account', async () => {
    db.getCalendarConnectionById.mockResolvedValueOnce(null);
    const response = await request(
      '/api/integrations/google-calendar/slots?connectionId=connection-b&date=2026-09-08',
    );

    expect(response.status).toBe(404);
    expect(db.getCalendarConnectionById).toHaveBeenCalledWith(env.DB, 'connection-b', OWN_SCOPE);
    expect(db.getBookingsInRange).not.toHaveBeenCalled();
    expect(google.getFreeBusy).not.toHaveBeenCalled();
  });

  it('returns 404 instead of listing bookings for an out-of-scope connection', async () => {
    db.getCalendarConnectionById.mockResolvedValueOnce(null);
    const response = await request(
      '/api/integrations/google-calendar/bookings?connectionId=connection-b',
    );

    expect(response.status).toBe(404);
    expect(db.getCalendarBookings).not.toHaveBeenCalled();
  });

  it('returns 404 instead of listing bookings for a friend in another account', async () => {
    db.getFriendById.mockResolvedValueOnce({ id: 'friend-b', line_account_id: 'account-b' });
    const response = await request(
      '/api/integrations/google-calendar/bookings?friendId=friend-b',
    );

    expect(response.status).toBe(404);
    expect(db.getCalendarBookings).not.toHaveBeenCalled();
  });

  it('returns 404 when deleting a connection in another account', async () => {
    db.deleteCalendarConnection.mockResolvedValueOnce(false);
    const response = await request('/api/integrations/google-calendar/connection-b', {
      method: 'DELETE',
    });

    expect(response.status).toBe(404);
    expect(db.deleteCalendarConnection).toHaveBeenCalledWith(env.DB, 'connection-b', OWN_SCOPE);
  });

  it('does not create a booking before the connection scope is authorized', async () => {
    db.getCalendarConnectionById.mockResolvedValueOnce(null);
    const response = await request('/api/integrations/google-calendar/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-b',
        title: '越境予約',
        startAt: BOOKING_A.start_at,
        endAt: BOOKING_A.end_at,
      }),
    });

    expect(response.status).toBe(404);
    expect(db.createCalendarBooking).not.toHaveBeenCalled();
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('does not attach a friend from another account to an allowed connection', async () => {
    db.getFriendById.mockResolvedValueOnce({ id: 'friend-b', line_account_id: 'account-b' });
    const response = await request('/api/integrations/google-calendar/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-a',
        friendId: 'friend-b',
        title: '越境予約',
        startAt: BOOKING_A.start_at,
        endAt: BOOKING_A.end_at,
      }),
    });

    expect(response.status).toBe(404);
    expect(db.createCalendarBooking).not.toHaveBeenCalled();
  });

  it('returns 404 before changing a booking in another account', async () => {
    db.getCalendarBookingById.mockResolvedValueOnce(null);
    const response = await request('/api/integrations/google-calendar/bookings/booking-b/status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(response.status).toBe(404);
    expect(db.updateCalendarBookingStatus).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  it('does not change Google when the scoped status update loses its race', async () => {
    db.getCalendarBookingById.mockResolvedValueOnce({ ...BOOKING_A, event_id: 'event-a' });
    db.getCalendarConnectionById.mockResolvedValueOnce({ ...CONNECTION_A, access_token: 'token-a' });
    db.updateCalendarBookingStatus.mockResolvedValueOnce(false);
    const response = await request('/api/integrations/google-calendar/bookings/booking-a/status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(response.status).toBe(404);
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  it('cleans up the Google event when its scoped D1 link loses its race', async () => {
    db.getCalendarConnectionById.mockResolvedValueOnce({ ...CONNECTION_A, access_token: 'token-a' });
    db.updateCalendarBookingEventId.mockResolvedValueOnce(false);
    const response = await request('/api/integrations/google-calendar/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-a',
        title: '競合予約',
        startAt: BOOKING_A.start_at,
        endAt: BOOKING_A.end_at,
      }),
    });

    expect(response.status).toBe(409);
    expect(google.createEvent).toHaveBeenCalled();
    expect(google.deleteEvent).toHaveBeenCalledWith('event-a');
  });

  it('keeps allowed booking creation and status changes working', async () => {
    const created = await request('/api/integrations/google-calendar/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-a',
        friendId: 'friend-a',
        title: '面談',
        startAt: BOOKING_A.start_at,
        endAt: BOOKING_A.end_at,
      }),
    });
    const updated = await request('/api/integrations/google-calendar/bookings/booking-a/status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

    expect(created.status).toBe(201);
    expect(db.createCalendarBooking).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      connectionId: 'connection-a',
      friendId: 'friend-a',
    }), OWN_SCOPE);
    expect(updated.status).toBe(200);
    expect(db.updateCalendarBookingStatus).toHaveBeenCalledWith(
      env.DB, 'booking-a', 'completed', OWN_SCOPE,
    );
  });
});
