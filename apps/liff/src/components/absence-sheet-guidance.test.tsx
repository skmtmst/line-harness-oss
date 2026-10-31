// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AbsenceSheet from './absence-sheet.js';
import { api, type EventBookingMine } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { eventAbsence: vi.fn() } }));
vi.mock('../lib/user-message.js', async load => ({ ...await load<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const booking: EventBookingMine = { id: 'on-booking', event_id: 'enabled', status: 'confirmed', customer_note: null, event_name: '振替ありの保存クラス', event_image_url: null, venue_name: null, venue_url: null, cancel_deadline_hours_before: null, slot_starts_at: '2026-11-01T08:00:00Z', slot_ends_at: '2026-11-01T09:00:00Z', makeup: { enabled: true, cutoff_at: '2026-11-01T05:00:00Z', valid_until: '2026-12-01T08:00:00Z' } };
const guidance = '振替が付いた場合、振替先はこのあと選べます。あとで選んでも大丈夫です。';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T03:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const mount = (item = booking, onClose = vi.fn(), onDone = vi.fn()) => { render(<AbsenceSheet booking={item} onClose={onClose} onDone={onDone} />); return { onClose, onDone }; };
it('振替の対象外では振替先の選択を約束せず、欠席と閉じるはできる', () => {
  vi.setSystemTime(new Date('2026-11-01T06:00:00Z'));
  const { onClose } = mount();
  expect(screen.getByText('今の欠席は振替の対象外です')).toBeTruthy();
  expect(screen.queryByText(/振替先はこのあと選べます/)).toBeNull();
  expect(screen.getByRole('button', { name: '欠席する' })).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(api.eventAbsence).not.toHaveBeenCalled();
});
it('締め内でも月上限の可能性を保ち、振替が付いた場合だけ次の選択を案内する', () => {
  mount();
  expect(screen.getByText(guidance)).toBeTruthy();
  expect(screen.getByText('条件を満たす場合は振替を 1 回お渡しします')).toBeTruthy();
  expect(screen.getByText(/今月の上限に達している場合は振替が付きません/)).toBeTruthy();
  expect(api.eventAbsence).not.toHaveBeenCalled();
});
it.each([-1, 0, 1])('締め境界%sミリ秒の既存条件を変えない', offset => {
  vi.setSystemTime(new Date(Date.parse('2026-11-01T05:00:00Z') + offset));
  mount();
  expect(Boolean(screen.queryByText(guidance))).toBe(offset <= 0);
  expect(screen.getByRole('button', { name: '欠席する' })).toHaveProperty('disabled', false);
});
it.each(['null', 'missing'] as const)('締め%sの既存条件でも付与の確約にはしない', state => {
  mount(state === 'missing' ? { ...booking, makeup: undefined } : { ...booking, makeup: { enabled: true, cutoff_at: null } });
  expect(screen.getByText(guidance)).toBeTruthy();
  expect(screen.getByText(/今月の上限に達している場合/)).toBeTruthy();
});
it('締めが不正な場合も選択を約束せず、既存の欠席操作は変えない', () => {
  mount({ ...booking, makeup: { enabled: true, cutoff_at: 'invalid' } });
  expect(screen.queryByText(/振替先はこのあと選べます/)).toBeNull();
  expect(screen.getByRole('button', { name: '欠席する' })).toHaveProperty('disabled', false);
});
it('失敗後は入力先IDと同じ受付キーで再試行し、上限なら既存の日本語理由を返す', async () => {
  vi.mocked(api.eventAbsence).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ credit: null, reason_if_none: 'monthly_cap' });
  const { onDone } = mount();
  fireEvent.click(screen.getByRole('button', { name: '欠席する' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '欠席を送れませんでした。もう一度お試しください。');
  expect(screen.getByText(guidance)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '欠席する' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ credit: null, reason: '今月の振替の上限に達しています。欠席は受け付けました。' }));
  expect(api.eventAbsence).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.eventAbsence).mock.calls[0]?.[0]).toBe('on-booking');
  expect(vi.mocked(api.eventAbsence).mock.calls[1]).toEqual(vi.mocked(api.eventAbsence).mock.calls[0]);
});
it('処理中の連打と閉じるを止め、同じ欠席を一度だけ送る', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.eventAbsence>>) => void;
  vi.mocked(api.eventAbsence).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { onClose, onDone } = mount();
  const submit = screen.getByRole('button', { name: '欠席する' });
  fireEvent.click(submit); fireEvent.click(submit);
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(api.eventAbsence).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'やめる' })).toHaveProperty('disabled', true);
  await act(async () => finish({ credit: null, reason_if_none: 'monthly_cap' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});
