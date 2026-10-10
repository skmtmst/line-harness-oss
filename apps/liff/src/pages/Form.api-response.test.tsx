// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Form from './Form.js';

// API を偽物に置き換えず、Worker の JSON → API 境界 → 入力画面まで通す。
vi.mock('../lib/liff-auth.js', () => ({ getIdToken: () => 'test-token', getLiffId: () => 'test-liff' }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/user-message.js', async (original) => ({
  ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn(),
}));

const form = {
  id: 'f1', name: '来店アンケート', description: null, isActive: true,
  layout: {
    version: 2, header: [],
    sections: [{ id: 's1', blocks: [
      { id: 'b1', kind: 'input', type: 'text', name: 'name', label: 'お名前', defaultValue: '初期値' },
    ] }],
    options: { restorePrevious: true, confirmDialog: { enabled: false } },
  },
};
let formResponse: unknown;
let latestResponse: unknown;
const fetcher = vi.fn(async (input: string | URL | Request) => {
  const path = new URL(String(input)).pathname;
  const body = path.endsWith('/my-latest') ? latestResponse
    : path === '/api/forms/f1' ? formResponse : { success: true, data: {} };
  return new Response(JSON.stringify(body), { status: 200 });
});

beforeEach(() => {
  formResponse = { success: true, data: form };
  latestResponse = { success: true, data: { answers: { name: '前回の名前' }, createdAt: '2026-10-01' } };
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(search = '') {
  render(<MemoryRouter initialEntries={[`/forms/f1${search}`]}>
    <Routes><Route path="/forms/:id" element={<Form />} /></Routes>
  </MemoryRouter>);
}

describe('L15：本物の応答でフォームを開き、失敗から読み直す', () => {
  it('公開フォームを表示し、包まれた前回回答を復元する', async () => {
    open();
    expect(await screen.findByDisplayValue('前回の名前')).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信する' })).toBeTruthy();
  });

  it('前回回答が null なら初期値を残す', async () => {
    latestResponse = { success: true, data: null };
    open();
    expect(await screen.findByDisplayValue('初期値')).toBeTruthy();
  });

  it('試し回答は合言葉を送り、前回の本物の回答を取得しない', async () => {
    formResponse = { success: true, data: { ...form, isTest: true } };
    open('?test_token=qa-token');
    expect(await screen.findByDisplayValue('初期値')).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/my-latest'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).searchParams.get('test_token') === 'qa-token')).toBe(true);
  });

  it.each([
    { success: true, data: null },
    { success: true, data: { ...form, layout: undefined } },
    { success: true, data: { ...form, layout: { header: [], sections: [{}] } } },
    { success: false, data: form },
  ])('不正な成功応答でも空画面にせず、読み直しで回復する (%j)', async (body) => {
    formResponse = body;
    open();
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' });
    expect(screen.queryByRole('button', { name: '送信する' })).toBeNull();
    formResponse = { success: true, data: form };
    fireEvent.click(retry);
    expect(await screen.findByDisplayValue('前回の名前')).toBeTruthy();
    expect(screen.queryByText('フォームを開けませんでした')).toBeNull();
  });
});
