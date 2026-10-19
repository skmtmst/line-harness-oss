// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LiffHeader from './liff-header.js';
import { api } from '../../lib/api.js';

const account = vi.hoisted(() => ({ id: 'header-a' }));
vi.mock('../../lib/liff-auth.js', () => ({ getLiffId: () => account.id }));
vi.mock('../../lib/api.js', () => ({ api: { liffConfig: vi.fn() } }));
afterEach(cleanup);

it('店の切替直後と遅い応答の後も、前の店名を出さない', async () => {
  let old!: (r: { success: boolean; data: { accountId: string; accountName: string; botBasicId: string } }) => void;
  vi.mocked(api.liffConfig).mockReturnValueOnce(new Promise((r) => { old = r; })).mockResolvedValueOnce({ success: true, data: { accountId: 'b', accountName: '新しい教室', botBasicId: '' } });
  const view = render(<LiffHeader title="ご案内" />);
  account.id = 'header-b';
  view.rerender(<LiffHeader title="ご案内" />);
  expect(await screen.findByText('新しい教室')).toBeTruthy();
  await act(async () => old({ success: true, data: { accountId: 'a', accountName: '前のサロン', botBasicId: '' } }));
  expect(screen.queryByText('前のサロン')).toBeNull();
  account.id = 'header-c';
  vi.mocked(api.liffConfig).mockResolvedValue({ success: true, data: { accountId: 'c', accountName: '次の面談', botBasicId: '' } });
  view.rerender(<LiffHeader title="ご案内" />);
  expect(screen.queryByText('新しい教室')).toBeNull();
  expect(await screen.findByText('次の面談')).toBeTruthy();
});
