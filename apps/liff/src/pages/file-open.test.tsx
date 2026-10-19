// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLiffContext } from '../lib/liff-auth.js';

vi.mock('@line/liff', () => ({ default: { isInClient: () => true, closeWindow: vi.fn() } }));
vi.mock('../lib/api.js', () => ({
  api: { liffConfig: () => Promise.resolve({ data: { accountName: '然 渋谷店' } }), customerLook: () => Promise.reject(new Error('x')) },
}));

import FileOpen from './file-open.js';

const ID = '11111111-2222-3333-4444-555555555555';
const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const issued = (over: object = {}) => ({
  success: true,
  data: { id: ID, url: `/images/chat-attachments/${ID}?expires=1&signature=s`, expiresAt: future(), filename: '見積書.pdf', mimeType: 'application/pdf', size: 2048, kind: 'file', ...over },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let routes: Array<(path: string, headers: Headers) => Response | Promise<Response>>;
const calls: Array<{ path: string; auth: string | null }> = [];

beforeEach(() => {
  routes = [];
  calls.length = 0;
  setLiffContext({ liffId: 'store', lineUserId: 'friend', idToken: 'token-of-A' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, auth: headers.get('Authorization') });
    const next = routes.shift();
    return next ? next(path, headers) : json({}, 500);
  }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/files/${ID}`]}>
      <Routes><Route path="/files/:id" element={<FileOpen />} /></Routes>
    </MemoryRouter>,
  );
}

test('開ける：本人確認のあとで名前と大きさを出し、ボタンを押すまで開かない', async () => {
  routes.push(() => json(issued()));
  mount();
  expect(await screen.findByText('見積書.pdf')).toBeTruthy();
  expect(screen.getByText(/書類 ・ 2.0 KB/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'ファイルを開く' })).toBeTruthy();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ path: `/api/liff/files/${ID}/download`, auth: 'Bearer token-of-A' });
});

test('画像はボタンのあとで画面の中に出す', async () => {
  routes.push(() => json(issued({ kind: 'image', filename: '写真.png', mimeType: 'image/png' })));
  routes.push(() => new Response(new Blob(['x'], { type: 'image/png' })));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ファイルを開く' }));
  const img = await screen.findByAltText('写真.png');
  expect(img.getAttribute('src')).toBe('blob:test');
  expect(calls[1].auth).toBe('Bearer token-of-A');
});

test('期限切れ：取得で403なら［もう一度開く］で新しいリンクを取り直す', async () => {
  routes.push(() => json(issued({ kind: 'image', filename: '写真.png' })));
  routes.push(() => json({ error: 'expired' }, 403));
  routes.push(() => json(issued({ kind: 'image', filename: '写真.png' })));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ファイルを開く' }));
  expect(await screen.findByText('リンクの期限が切れました')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度開く' }));
  expect(await screen.findByRole('button', { name: 'ファイルを開く' })).toBeTruthy();
  expect(calls.map((c) => c.path)).toEqual([
    `/api/liff/files/${ID}/download`, `/images/chat-attachments/${ID}`, `/api/liff/files/${ID}/download`,
  ]);
});

test('期限が過ぎたリンクは通信せず期限切れにする', async () => {
  routes.push(() => json(issued({ expiresAt: new Date(Date.now() - 1000).toISOString() })));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ファイルを開く' }));
  expect(await screen.findByText('リンクの期限が切れました')).toBeTruthy();
  expect(calls).toHaveLength(1);
});

test('別人・別店(404)は理由と問い合わせを出し、ファイル名は出さない', async () => {
  routes.push(() => json({ success: false, code: 'DOWNLOAD_UNAVAILABLE', error: 'このファイルは利用できません。お店へお問い合わせください' }, 404));
  mount();
  expect(await screen.findByText('このファイルは利用できません。お店へお問い合わせください')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'ファイルを開く' })).toBeNull();
  expect(screen.queryByText('見積書.pdf')).toBeNull();
});

test('取得時に元が消えていたら「削除されました」', async () => {
  routes.push(() => json(issued({ kind: 'image' })));
  routes.push(() => json({}, 404));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ファイルを開く' }));
  expect(await screen.findByText('このファイルは削除されました')).toBeTruthy();
});

test('通信の失敗(502)は［もう一度試す］で読み直せる', async () => {
  routes.push(() => json({}, 502));
  routes.push(() => json(issued()));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度試す' }));
  expect(await screen.findByText('見積書.pdf')).toBeTruthy();
});

test('署名リンクが別の origin なら認証情報を送らない', async () => {
  routes.push(() => json(issued({ kind: 'image', url: 'https://evil.example/images/chat-attachments/x?signature=s' })));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ファイルを開く' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'もう一度試す' })).toBeTruthy());
  expect(calls).toHaveLength(1);
});

test('混雑(429)は Retry-After の秒数を出し、［もう一度試す］で読み直せる', async () => {
  routes.push(() => json({}, 429));
  routes.push(() => json(issued()));
  routes[0] = () => new Response('{}', { status: 429, headers: { 'Retry-After': '45' } });
  mount();
  expect(await screen.findByText('45秒ほど待ってから、もう一度お試しください。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }));
  expect(await screen.findByText('見積書.pdf')).toBeTruthy();
});
