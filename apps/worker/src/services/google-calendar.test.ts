import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarClient, GoogleCalendarReadError } from './google-calendar.js';
const client = new GoogleCalendarClient({ calendarId: 'target', accessToken: 'test-token' });
afterEach(() => vi.unstubAllGlobals());
function response(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
describe('FreeBusyの取得結果', () => {
  it.each([
    {}, { calendars: {} }, { calendars: { other: { busy: [] } } },
    { calendars: { target: { errors: [{ reason: 'notFound' }], busy: [] } } },
    { calendars: { target: {} } }, { calendars: { target: { busy: null } } },
    { calendars: { target: { busy: [{ start: 'bad', end: 'bad' }] } } },
    { calendars: { target: { busy: [{ start: '2026-10-08T02:00:00Z', end: '2026-10-08T01:00:00Z' }] } } },
  ])('未取得・部分的な失敗・壊れた区間を予定なしにしない: %j', async body => {
    response(body);
    await expect(client.getFreeBusy('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z'))
      .rejects.toBeInstanceOf(GoogleCalendarReadError);
  });
  it('予定なしは確認済みの空配列だけを返す', async () => {
    response({ calendars: { target: { errors: [], busy: [] } } });
    await expect(client.getFreeBusy('from', 'to')).resolves.toEqual([]);
  });
  it('正常な区間は返し、HTTPエラーには外部の本文を含めない', async () => {
    const busy = [{ start: '2026-10-08T01:00:00Z', end: '2026-10-08T02:00:00Z' }];
    response({ calendars: { target: { busy } } });
    await expect(client.getFreeBusy('from', 'to')).resolves.toEqual(busy);
    response({ secret: 'private-calendar-info' }, 403);
    await expect(client.getFreeBusy('from', 'to')).rejects.toMatchObject({ status: 403, message: 'calendar_read_failed' });
  });
});
