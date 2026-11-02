// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Confirm from './confirm.js';
import { api } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { cancellationPreview: vi.fn(), entitlements: vi.fn(), createRequest: vi.fn(), seriesPreview: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('続けて予約の空き確認に失敗したら単発予約を送らず、再確認できる', async () => {
  vi.mocked(api.cancellationPreview).mockResolvedValue({ enabled: false } as never);
  vi.mocked(api.entitlements).mockResolvedValue([]);
  vi.mocked(api.seriesPreview).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ occurrences: [{ index: 0, starts_at: '2099-01-01T01:00:00Z', available: true, alternatives: [] }] });
  render(<Confirm menu={{ id: 'm', name: '予約', duration_minutes: 60, base_price: 0, recurring: { enabled: true, max_count: 4 } } as never} staff={{ id: 's', display_name: '担当', price: 0, duration_minutes: 60 } as never} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm={false} onSubmitted={() => {}} />);
  const submit = screen.getByRole('button', { name: /予約をリクエスト/ });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('switch', { name: '毎週この時間で続ける' }));
  expect(submit).toHaveProperty('disabled', true);
  await screen.findByRole('alert');
  expect(submit).toHaveProperty('disabled', true);
  fireEvent.click(submit);
  expect(api.createRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
  await screen.findByText(/1 回すべて予約します/);
  await waitFor(() => expect(screen.getByRole('button', { name: '1 回分を予約する' })).toHaveProperty('disabled', false));
  expect(api.createRequest).not.toHaveBeenCalled();
});
