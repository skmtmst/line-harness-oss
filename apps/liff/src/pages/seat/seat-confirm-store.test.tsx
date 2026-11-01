// @vitest-environment happy-dom
import { type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRestaurantReservationForm } from '@line-crm/shared';
import SeatConfirm from './seat-confirm.js';

afterEach(cleanup);

function props(overrides: Partial<ComponentProps<typeof SeatConfirm>> = {}): ComponentProps<typeof SeatConfirm> {
  return {
    timeZone: 'Asia/Tokyo', storeName: '然 - NEN - 本店', customerName: '予約する方',
    startsAt: '2099-11-02T10:00:00Z', endsAt: '2099-11-02T12:00:00Z', guestCount: 2,
    cancelDeadlineMinutesBefore: 120, seat: 'テーブル席', late: '遅れる時はLINEで連絡してください',
    note: '', phone: '', onNote: vi.fn(), onPhone: vi.fn(), holdExpiresAt: null,
    holdMinutes: 10, reschedule: false, error: null, onBack: vi.fn(), onExpired: vi.fn(), ...overrides,
  };
}

function definition(required: boolean) {
  const form = defaultRestaurantReservationForm();
  form.fields = form.fields.map(field => field.id === 'phone' ? { ...field, required } : field);
  return form;
}

describe('最終確認の対象店', () => {
  it.each([
    { reschedule: false, required: false, open: true },
    { reschedule: false, required: true, open: true },
    { reschedule: true, required: false, open: false },
    { reschedule: true, required: true, open: true },
  ])('新規/変更・必須の既存の初期展開を保つ（%j）', scenario => {
    const view = render(<SeatConfirm {...props({ reschedule: scenario.reschedule, definition: definition(scenario.required) })} />);
    expect(view.container.querySelector('details')?.open).toBe(scenario.open);
  });

  it.each([
    { reschedule: false, required: false },
    { reschedule: false, required: true },
    { reschedule: true, required: false },
    { reschedule: true, required: true },
  ])('折り畳みの外の確認カードへ同じ店名を1回だけ出す（%j）', scenario => {
    const view = render(<SeatConfirm {...props({ reschedule: scenario.reschedule, definition: definition(scenario.required) })} />);
    const store = screen.getByText(/然 - NEN - 本店/);
    const summary = screen.getByRole('heading', { name: scenario.reschedule ? 'この内容に変更します' : 'ご予約の内容' }).closest('[data-liff-card]');
    expect(summary?.contains(store)).toBe(true);
    expect(store.closest('details')).toBeNull();
    expect(view.container.querySelector('details')?.textContent).not.toContain('然 - NEN - 本店');
    expect(screen.getAllByText(/然 - NEN - 本店/)).toHaveLength(1);
  });

  it('新規の詳細を手動で閉じても店・日時・人数を確認できる', () => {
    const view = render(<SeatConfirm {...props()} />);
    const details = view.container.querySelector('details')!;
    details.open = false;
    fireEvent(details, new Event('toggle'));
    const store = screen.getByText(/然 - NEN - 本店/);
    expect(store.closest('details')).toBeNull();
    expect(details.open).toBe(false);
    const summary = store.closest('[data-liff-card]');
    expect(summary?.textContent).toContain('19:00・2名');
    expect(summary?.textContent).toContain('コース：席のみ');
  });

  it('受け取った対象店名が変われば同じ確認カードへ反映する', () => {
    const view = render(<SeatConfirm {...props()} />);
    view.rerender(<SeatConfirm {...props({ storeName: '然 - NEN - 海辺店' })} />);
    const store = screen.getByText(/然 - NEN - 海辺店/);
    expect(store.closest('details')).toBeNull();
    expect(screen.queryByText(/然 - NEN - 本店/)).toBeNull();
  });
});


it.each(['', '   '])('店名が空なら別の名前や空の見出しを作らない（%s）', storeName => {
  render(<SeatConfirm {...props({ storeName })} />);
  const summary = screen.getByRole('heading', { name: 'ご予約の内容' }).closest('[data-liff-card]');
  expect(summary?.textContent).not.toContain('お店：');
  expect(summary?.textContent).not.toContain('然 - NEN -');
});
