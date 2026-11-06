import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  friends: { get: vi.fn(), list: vi.fn(), setMetadata: vi.fn(), addTag: vi.fn(), removeTag: vi.fn() },
  tags: { list: vi.fn(), create: vi.fn() },
  sendTextToFriend: vi.fn(), sendFlexToFriend: vi.fn(),
  listCustomers: vi.fn(), getUpcomingAppointments: vi.fn(), getExpiringMemberships: vi.fn(),
}));
vi.mock('@line-harness/sdk', () => ({
  LineHarness: class {
    friends = mocks.friends;
    tags = mocks.tags;
    sendTextToFriend = mocks.sendTextToFriend;
    sendFlexToFriend = mocks.sendFlexToFriend;
  },
}));
vi.mock('../src/external-api.js', () => ({
  MyServiceClient: class {
    listCustomers = mocks.listCustomers;
    getUpcomingAppointments = mocks.getUpcomingAppointments;
    getExpiringMemberships = mocks.getExpiringMemberships;
  },
}));
import { checkAndNotify } from '../src/notify.js';
import { syncExternalData } from '../src/sync.js';

const env = { LINE_HARNESS_API_URL: 'https://example.invalid', LINE_HARNESS_API_KEY: 'private-key', EXTERNAL_API_KEY: 'external-key' };
const privateError = new Error('customer-body private-key friend-private external-private');
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('use mocks only'));
  mocks.tags.list.mockResolvedValue([
    { id: 'appt-tag', name: 'myservice:appt-reminded' },
    { id: 'renewal-tag', name: 'myservice:renewal-reminder' },
    ...['free', 'basic', 'premium'].map(tier => ({ id: tier, name: `myservice:${tier}` })),
  ]);
  mocks.getUpcomingAppointments.mockResolvedValue([{ lineHarnessFriendId: 'friend-private', time: '10:00', location: 'customer-body' }]);
  mocks.getExpiringMemberships.mockResolvedValue([{ lineHarnessFriendId: 'friend-private', planName: 'customer-body', expiresAt: '2026-10-19', renewUrl: 'https://example.invalid' }]);
  mocks.listCustomers.mockResolvedValue([{ id: 'external-private', lineUserId: 'line-private', tier: 'free', visitCount: 1 }]);
  mocks.friends.get.mockResolvedValue({ tags: [] });
  mocks.friends.list.mockResolvedValue({ items: [{ id: 'friend-private', metadata: { externalId: 'external-private' } }], hasNextPage: false });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  const output = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
  for (const value of ['friend-private', 'external-private', 'line-private', 'customer-body', 'private-key', 'external-key']) {
    expect(output).not.toContain(value);
  }
  vi.restoreAllMocks();
});

it('keeps successful notification operations and logs only fixed codes', async () => {
  await checkAndNotify(env);
  expect(mocks.sendTextToFriend).toHaveBeenCalledWith('friend-private', expect.stringContaining('customer-body'));
  expect(mocks.sendFlexToFriend).toHaveBeenCalledWith('friend-private', expect.stringContaining('customer-body'));
  expect(log.mock.calls).toEqual([['[Notify] appointment_reminder_sent'], ['[Notify] membership_reminder_sent']]);
  expect(error).not.toHaveBeenCalled();
});

it('keeps duplicate prevention without logging customer identifiers', async () => {
  mocks.friends.get.mockResolvedValue({ tags: [{ name: 'myservice:appt-reminded' }, { name: 'myservice:renewal-reminder' }] });
  await checkAndNotify(env);
  expect(mocks.friends.addTag).not.toHaveBeenCalled();
  expect(mocks.sendTextToFriend).not.toHaveBeenCalled();
  expect(mocks.sendFlexToFriend).not.toHaveBeenCalled();
  expect(log.mock.calls).toEqual([['[Notify] appointment_already_reminded'], ['[Notify] membership_already_notified']]);
});

it('does not log external errors or change failure handling', async () => {
  mocks.sendTextToFriend.mockRejectedValue(privateError);
  mocks.sendFlexToFriend.mockRejectedValue(privateError);
  await expect(checkAndNotify(env)).resolves.toBeUndefined();
  expect(error.mock.calls).toEqual([['[Notify] appointment_reminder_failed'], ['[Notify] membership_reminder_failed']]);
});

it('keeps customer synchronization and its fixed success log', async () => {
  await syncExternalData(env);
  expect(mocks.friends.setMetadata).toHaveBeenCalledWith('friend-private', expect.objectContaining({ externalId: 'external-private' }));
  expect(mocks.friends.addTag).toHaveBeenCalledWith('friend-private', 'free');
  expect(log.mock.calls).toEqual([['[Sync] customer_updated'], ['[Sync] completed']]);
});

it('does not put customer ids or external errors in synchronization failure logs', async () => {
  mocks.friends.setMetadata.mockRejectedValue(privateError);
  await expect(syncExternalData(env)).resolves.toBeUndefined();
  expect(error.mock.calls).toEqual([['[Sync] customer_update_failed']]);
  expect(log.mock.calls).toEqual([['[Sync] completed']]);
});
