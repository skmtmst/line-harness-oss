// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Form from './form.js';
import { api } from '../lib/api.js';

vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/liff-auth.js', () => ({ getIdToken: () => 'identity', getLiffId: () => 'account' }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const form = {
  id: 'f1', name: '試しの受付', description: null, isActive: false, isTest: true,
  layout: { version: 2, header: [], sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'name', label: 'お名前', defaultValue: '初期値' }] }], options: { restorePrevious: true, confirmDialog: { enabled: false } } },
};
const calls = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const body = url.pathname === '/api/forms/f1' ? form
    : url.pathname.endsWith('/submit') ? { isTest: true, complete: true }
    : {};
  return new Response(JSON.stringify({ success: true, data: body }), { status: 200 });
});
beforeEach(() => { calls.mockClear(); vi.stubGlobal('fetch', calls); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('停止中の下書きにも試し合言葉を送り、本回答を復元せず試しとして送る', async () => {
  render(<MemoryRouter initialEntries={['/forms/f1?test_token=qa%2Ftoken']}><Routes><Route path="/forms/:id" element={<Form />} /></Routes></MemoryRouter>);
  expect(await screen.findByDisplayValue('初期値')).toBeTruthy();
  expect(screen.getByText('試し回答中です。この回答は集計に入りません。')).toBeTruthy();
  const get = calls.mock.calls.find(([url]) => new URL(String(url)).pathname === '/api/forms/f1');
  expect(new URL(String(get![0])).searchParams.get('test_token')).toBe('qa/token');
  expect(calls.mock.calls.some(([url]) => String(url).includes('/my-latest'))).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'お名前' }), { target: { value: '試しの回答' } });
  fireEvent.click(screen.getByRole('button', { name: '送信する' }));
  expect(await screen.findByText('試しの回答のため、集計には入りません。')).toBeTruthy();
  const all = calls.mock.calls as unknown as [string, RequestInit][];
  const submit = all.find(([url]) => new URL(String(url)).pathname.endsWith('/submit'))!;
  expect(JSON.parse(String(submit[1].body))).toMatchObject({ testToken: 'qa/token', data: { name: '試しの回答' } });
  expect(submit[1].method).toBe('POST');
});

it('試しの添付も合言葉と質問を同じアップロード先へ添える', async () => {
  const file = new File(['image'], 'fixture.png', { type: 'image/png' });
  await api.uploadFormFile('f1', file, 'qa/token', 'question', 'front');
  await waitFor(() => expect(calls).toHaveBeenCalledOnce());
  const [input, init] = (calls.mock.calls as unknown as [string | URL, RequestInit][])[0];
  const url = new URL(String(input));
  expect(url.pathname).toBe('/api/forms/f1/files');
  expect(url.searchParams.get('test_token')).toBe('qa/token');
  expect(url.searchParams.get('block_id')).toBe('question');
  expect(init.body).toBe(file);
});
