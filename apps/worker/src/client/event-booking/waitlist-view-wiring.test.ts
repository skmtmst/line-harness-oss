// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const event = {
  id: 'event', name: '相談会', venue_name: null, venue_url: null, image_url: null,
  description: null, description_centered: 0, max_bookings_per_friend: 1,
  requires_approval: 0, cancel_deadline_hours_before: null, waitlist_enabled: 1,
};
const slot = {
  id: 'slot', event_id: 'event', starts_at: '2030-10-22T10:00:00Z', ends_at: '2030-10-22T11:00:00Z',
  capacity: 1, is_active: 1, active_count: 1, remaining: 0,
};
const ctx = { liffId: 'store', lineUserId: 'friend', idToken: 'fixture' };

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  expect(found, label).toBeTruthy();
  return found!;
}

async function mount(input: { waitlist?: boolean; remaining?: number; existing?: boolean; result?: object; failure?: boolean } = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="app"></div>';
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (init?.method === 'POST') return Response.json(input.result ?? { waitlisted: true }, { status: input.failure ? 503 : 200 });
    if (path.endsWith('/slots')) return Response.json({ items: [{ ...slot, remaining: input.remaining ?? 0 }] });
    if (path.endsWith('/me')) return Response.json({ items: input.existing && new URL(url).searchParams.get('tab') === 'upcoming'
      ? [{ id: 'existing', event_id: event.id, status: 'confirmed' }] : [] });
    return Response.json({ ...event, waitlist_enabled: input.waitlist === false ? 0 : 1 });
  });
  vi.stubGlobal('fetch', fetch);
  const { mountEventBooking } = await import('./main.js');
  await act(async () => mountEventBooking(document.getElementById('app')!, ctx, { kind: 'detail', eventId: event.id }));
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('イベント画面からのキャンセル待ち', () => {
  const slotCases: Array<[NonNullable<Parameters<typeof mount>[0]>, string, boolean]> = [
    [{}, '満員（キャンセル待ち）', false],
    [{ waitlist: false }, '満員', true],
    [{ existing: true }, '満員（キャンセル待ち）', true],
    [{ remaining: 1 }, '残 1', false],
  ];
  test.each(slotCases)('枠の状態%sで押せるかと残席表示が一致する', async (input, label, disabled) => {
    await mount(input);
    const target = button(label);
    expect(target.disabled).toBe(disabled);
    if (!disabled) {
      await act(async () => target.click());
      expect(document.querySelector('h1')?.textContent).toContain(input.remaining ? '予約内容のご確認' : 'キャンセル待ちのご確認');
    }
  });

  const outcomeCases: Array<[{ waitlisted?: boolean; status?: string }, string, string]> = [
    [{ waitlisted: true, status: 'confirmed' }, 'キャンセル待ちに入りました', 'この時点では予約は取れていません。'],
    [{ status: 'requested' }, '受付しました', '運営の承認をお待ちください。'],
    [{ status: 'confirmed' }, '予約が確定しました', 'LINE で詳細をお送りしました。'],
  ];
  test.each(outcomeCases)('申込応答%sを、待ち・承認待ち・確定の正しい完了画面へ渡す', async (result, title, body) => {
    const fetch = await mount({ result, remaining: result.waitlisted ? 0 : 1 });
    await act(async () => button(result.waitlisted ? '満員（キャンセル待ち）' : '残 1').click());
    await act(async () => button(result.waitlisted ? 'キャンセル待ちに入る' : '予約をリクエスト').click());
    expect(document.querySelector('h1')?.textContent).toBe(title);
    expect(document.body.textContent).toContain(body);
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ slot_id: 'slot' });
    expect(new Headers(post[1]!.headers).get('Idempotency-Key')).toBeTruthy();
  });

  test('申込失敗では完了画面へ進めず、再試行できる', async () => {
    await mount({ failure: true });
    await act(async () => button('満員（キャンセル待ち）').click());
    await act(async () => button('キャンセル待ちに入る').click());
    expect(document.querySelector('h1')?.textContent).toBe('キャンセル待ちのご確認');
    expect(button('キャンセル待ちに入る').disabled).toBe(false);
    expect(document.body.textContent).not.toContain('キャンセル待ちに入りました');
  });
});
