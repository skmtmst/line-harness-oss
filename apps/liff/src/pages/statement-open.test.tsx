// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@line/liff', () => ({ default: { isInClient: () => true, closeWindow: vi.fn(), getAccessToken: () => 'access-of-A' } }));
vi.mock('../lib/api.js', () => ({
  api: { liffConfig: () => Promise.resolve({ data: { accountName: '然 渋谷店' } }), customerLook: () => Promise.reject(new Error('x')) },
}));

import StatementOpen from './statement-open.js';

const ID = 'st-1';
const DL = `/api/liff/affiliate/statements/${ID}/download`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const issued = (over: object = {}) => json({ success: true, data: { url: `${DL}?expires=1&signature=s`, expiresAt: new Date(Date.now() + 600000).toISOString(), ...over } });

let routes: Array<() => Response>;
const calls: Array<{ path: string; search: string; auth: string | null }> = [];

beforeEach(() => {
  routes = []; calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), window.location.origin);
    calls.push({ path: u.pathname, search: u.search, auth: new Headers(init?.headers).get('Authorization') });
    return routes.shift()?.() ?? json({}, 500);
  }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/statements/${ID}`]}>
      <Routes><Route path="/statements/:id" element={<StatementOpen />} /></Routes>
    </MemoryRouter>,
  );
}

test('開ける：発行は ?issue=1 と access token、認証情報は query に載せない', async () => {
  routes.push(() => issued());
  mount();
  expect(await screen.findByRole('button', { name: '明細を開く' })).toBeTruthy();
  expect(calls).toEqual([{ path: DL, search: '?issue=1', auth: 'Bearer access-of-A' }]);
});

test('期限切れ：取得で403なら［もう一度取得］で取り直す', async () => {
  routes.push(() => issued());
  routes.push(() => json({}, 403));
  routes.push(() => issued());
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '明細を開く' }));
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度開く' }));
  expect(await screen.findByRole('button', { name: '明細を開く' })).toBeTruthy();
  expect(calls).toHaveLength(3);
});

test('別人・別店・停止（404）は「明細を利用できません」', async () => {
  routes.push(() => json({}, 404));
  mount();
  expect(await screen.findByText('明細を利用できません')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '明細を開く' })).toBeNull();
});

test('401 は LINEでログインの案内、再試行できる', async () => {
  routes.push(() => json({}, 401));
  mount();
  expect(await screen.findByText('LINEでログインして、もう一度お試しください')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'もう一度試す' })).toBeTruthy();
});

test('混雑（429）は Retry-After の秒数を出す', async () => {
  routes.push(() => json({}, 429, { 'Retry-After': '45' }));
  mount();
  expect(await screen.findByText('45秒ほど待ってから、もう一度お試しください。')).toBeTruthy();
});

test('署名リンクに認証情報の query があれば取得しない', async () => {
  routes.push(() => issued({ url: `${DL}?signature=s&lineAccessToken=x` }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '明細を開く' }));
  expect(await screen.findByRole('button', { name: 'もう一度試す' })).toBeTruthy();
  expect(calls).toHaveLength(1);
});
