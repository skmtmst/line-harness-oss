// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AbsenceSheet from './absence-sheet.js';
import { api, type EventBookingMine } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { eventAbsence: vi.fn() } }));
const booking = { id: 'lesson', event_name: '朝のクラス', slot_starts_at: '2026-11-20T01:00:00Z', makeup: { enabled: true, cutoff_at: '2026-11-19T22:00:00Z' } } as EventBookingMine;
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T00:00:00Z')); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it('月上限が不明な確認窓で振替の付与を約束せず、欠席だけも確定できる', async () => {
  vi.mocked(api.eventAbsence).mockResolvedValue({ credit: null, reason_if_none: 'monthly_cap' });
  const done = vi.fn();
  render(<AbsenceSheet booking={booking} onClose={() => {}} onDone={done} />);
  expect(screen.getByText(/上限に達している場合/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '欠席する' }));
  await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ credit: null, reason: expect.stringContaining('今月の振替の上限に達しています') }));
  expect(done.mock.calls[0][0].reason).not.toContain('monthly_cap');
  expect(api.eventAbsence).toHaveBeenCalledTimes(1);
});

it.each(['cutoff_passed', 'makeup_disabled', 'unknown_reason'])('振替が付かない理由%sを日本語で両方の履歴へ返す', async (reason) => {
  vi.mocked(api.eventAbsence).mockResolvedValue({ credit: null, reason_if_none: reason });
  const done = vi.fn();
  render(<AbsenceSheet booking={booking} onClose={() => {}} onDone={done} />);
  fireEvent.click(screen.getByRole('button', { name: '欠席する' }));
  await vi.waitFor(() => expect(done).toHaveBeenCalled());
  expect(done.mock.calls[0][0].reason).toContain('欠席は受け付けました');
  expect(done.mock.calls[0][0].reason).not.toContain(reason);
});

it('振替が付いた時は、返事に月上限のコードがあっても上限の案内を出さない', async () => {
  const credit = { id: 'credit', expires_at: '2026-11-30T00:00:00Z', status: 'open' } as const;
  vi.mocked(api.eventAbsence).mockResolvedValue({ credit, reason_if_none: 'monthly_cap' });
  const done = vi.fn();
  render(<AbsenceSheet booking={booking} onClose={() => {}} onDone={done} />);
  fireEvent.click(screen.getByRole('button', { name: '欠席する' }));
  await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ credit, reason: undefined }));
});
