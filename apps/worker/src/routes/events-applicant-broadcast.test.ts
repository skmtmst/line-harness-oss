import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const snapshots = vi.hoisted(() => ({ getEventApplicantSnapshot: vi.fn() }));
const broadcasts = vi.hoisted(() => ({ getBroadcastById: vi.fn(), createBroadcast: vi.fn() }));

vi.mock('../services/event-applicant-snapshot.js', () => ({
  createEventApplicantSnapshot: vi.fn(),
  getEventApplicantSnapshot: snapshots.getEventApplicantSnapshot,
}));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
vi.mock('@line-crm/db', () => ({
  createBroadcast: broadcasts.createBroadcast,
  getBroadcastById: broadcasts.getBroadcastById,
  resolveLineCredential: vi.fn(),
}));

const { default: events } = await import('./events.js');

type TestEnv = { Bindings: { DB: D1Database }; Variables: { staff: { id: string; role: 'owner' } } };

function app() {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', role: 'owner' });
    c.env = { DB: {} as D1Database };
    await next();
  });
  app.route('/', events);
  return app;
}

const snapshotData = {
  occurrence: { id: 'slot-a', eventId: 'event-a', startsAt: '2099-01-01T00:00:00.000Z', endsAt: '2099-01-01T01:00:00.000Z', capacity: 3, activeSeats: 1, version: 1 },
  summary: { bookingCount: 1, waitingCount: 1, activeSeats: 1 },
  applicants: [
    { source: 'booking' as const, id: 'booking-a', friendId: 'friend-a', displayName: 'A', pictureUrl: null, status: 'confirmed', partySize: 1, appliedAt: '2099-01-01T00:00:00.000Z', answers: null, firstParticipation: { isFirst: null, attendedCount: null, checkedAt: null }, offeredAt: null, offerExpiresAt: null },
    { source: 'waitlist' as const, id: 'wait-b', friendId: 'friend-b', displayName: 'B', pictureUrl: null, status: 'waiting', partySize: 1, appliedAt: '2099-01-01T00:01:00.000Z', answers: null, firstParticipation: { isFirst: null, attendedCount: null, checkedAt: null }, offeredAt: null, offerExpiresAt: null },
  ],
};
const key = '00000000-0000-4000-8000-000000000001';

describe('event applicant broadcast preview', () => {
  beforeEach(() => {
    snapshots.getEventApplicantSnapshot.mockReset();
    broadcasts.getBroadcastById.mockReset();
    broadcasts.createBroadcast.mockReset();
    snapshots.getEventApplicantSnapshot.mockResolvedValue({ kind: 'found', snapshot: { id: 'snapshot-a', data: snapshotData, expiresAt: '2099-01-01T00:15:00.000Z' } });
    broadcasts.getBroadcastById.mockResolvedValue(null);
    broadcasts.createBroadcast.mockImplementation(async (_db, input) => ({
      id: input.id, title: input.title, message_content: input.messageContent, line_account_id: input.lineAccountId,
      target_type: input.targetType, segment_conditions: input.segmentConditions, draft_payload_json: input.draftPayloadJson,
    }));
  });

  test('表示snapshotだけを固定し、後続の申込変更後も同一keyを同じ送信対象として再生する', async () => {
    const server = app();
    const body = { title: '案内', messageContent: '本文', snapshotId: 'snapshot-a' };
    const first = await server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    expect(broadcasts.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      segmentConditions: JSON.stringify({ operator: 'AND', rules: [{ type: 'friend_id_in', value: ['friend-a', 'friend-b'] }] }),
    }));
    const created = await broadcasts.createBroadcast.mock.results[0].value;
    broadcasts.getBroadcastById.mockResolvedValue(created);
    // DB上の申込者が変わっても、このrouteはsnapshot serviceを再読込しない。
    snapshots.getEventApplicantSnapshot.mockClear();
    const replay = await server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(snapshots.getEventApplicantSnapshot).not.toHaveBeenCalled();
    expect(broadcasts.createBroadcast).toHaveBeenCalledTimes(1);
  });

  test('期限切れ・account外snapshotは新しいpreviewを作らない', async () => {
    const server = app();
    snapshots.getEventApplicantSnapshot.mockResolvedValueOnce({ kind: 'expired' });
    const expired = await server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ title: '案内', messageContent: '本文', snapshotId: 'old' }),
    });
    expect(expired.status).toBe(410);
    snapshots.getEventApplicantSnapshot.mockResolvedValueOnce({ kind: 'not_found' });
    const foreign = await server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': '00000000-0000-4000-8000-000000000002' }, body: JSON.stringify({ title: '案内', messageContent: '本文', snapshotId: 'other-account' }),
    });
    expect(foreign.status).toBe(404);
    expect(broadcasts.createBroadcast).not.toHaveBeenCalled();
  });

  test('同じIdempotency-Keyの同時previewはPK競合後に勝者のsnapshotを再生する', async () => {
    const server = app();
    let releaseFirst: (() => void) | undefined;
    const firstInserted = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let winner: Record<string, unknown> | null = null;
    broadcasts.createBroadcast.mockImplementationOnce(async (_db, input) => {
      winner = { id: input.id, title: input.title, message_content: input.messageContent, line_account_id: input.lineAccountId, target_type: input.targetType, segment_conditions: input.segmentConditions, draft_payload_json: input.draftPayloadJson };
      await firstInserted;
      return winner;
    }).mockRejectedValueOnce(new Error('UNIQUE constraint failed: broadcasts.id'));
    broadcasts.getBroadcastById.mockImplementation(async () => winner);
    const body = JSON.stringify({ title: '案内', messageContent: '本文', snapshotId: 'snapshot-a' });
    const first = server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body });
    const second = server.request('/api/events/admin/occurrences/slot-a/applicant-broadcasts/preview?account_id=account-a', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body });
    await Promise.resolve();
    releaseFirst?.();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 201]);
    const [firstData, secondData] = await Promise.all([firstResponse.json(), secondResponse.json()]) as Array<{ data: { broadcastId: string; recipientCount: number } }>;
    expect(firstData.data).toEqual(secondData.data);
    expect(broadcasts.createBroadcast).toHaveBeenCalledTimes(2);
  });
});
