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

it.each(['このフォームの回答期限は終了しました', 'このフォームは、お一人さま1回までです', 'このフォームは受付を終了しました'])('入力前に受付できない理由を知らせる：%s', async reason => {
  formResponse = { success: true, data: { ...form, availability: { accepting: false, reason, deadlineAt: null, oncePerFriend: false, totalRemaining: 0, choices: {} } } };
  open();
  expect(await screen.findByText(reason)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '送信する' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('締め切りと1回制限・残り件数を先に出し、定員いっぱいの選択肢を無効にする', async () => {
  formResponse = { success: true, data: { ...form,
    availability: { accepting: true, reason: null, deadlineAt: '2099-10-01T15:00:00Z', oncePerFriend: true, totalRemaining: 3, choices: { pick: { full: { full: true, remaining: 0 }, open: { full: false, remaining: 2 } } } },
    layout: { ...form.layout, sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', type: 'radio', name: 'pick', label: 'ご希望', choices: [{ id: 'full', label: '満席', defaultSelected: true }, { id: 'open', label: '空席' }] }] }], options: {} },
  } };
  open();
  expect(await screen.findByText('回答はお一人さま1回までです')).toBeTruthy();
  expect(screen.getByText(/締め切り：/)).toBeTruthy();
  expect(screen.getByText(/受付上限まで残り3件/)).toBeTruthy();
  const full = screen.getByRole('radio', { name: '満席（受付終了）' }) as HTMLInputElement;
  expect(full.disabled).toBe(true);
  expect(full.checked).toBe(false);
  expect((screen.getByRole('radio', { name: '空席（残り2件）' }) as HTMLInputElement).disabled).toBe(false);
});

it.each(['radio', 'checkbox', 'select'])('満席のその他の初期値と前回の自由記入を復元しない：%s', async type => {
  formResponse = { success: true, data: { ...form,
    availability: { accepting: true, reason: null, deadlineAt: null, oncePerFriend: false, totalRemaining: null, choices: { pick: { full: { full: true, remaining: 0 } } } },
    layout: { ...form.layout, sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', type, name: 'pick', label: 'ご希望', defaultValue: '前回の自由記入', choices: [{ id: 'open', label: '通常' }, { id: 'full', label: 'その他', isOther: true }] }] }] },
  } };
  latestResponse = { success: true, data: { answers: { pick: type === 'checkbox' ? ['前回の自由記入'] : '前回の自由記入' }, createdAt: '2026-10-01' } };
  open();
  await screen.findByRole('button', { name: '送信する' });
  await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('/my-latest'))).toBe(true));
  expect(screen.queryByDisplayValue('前回の自由記入')).toBeNull();
  if (type !== 'select') expect((screen.getByRole(type, { name: 'その他（受付終了）' }) as HTMLInputElement).checked).toBe(false);
});
