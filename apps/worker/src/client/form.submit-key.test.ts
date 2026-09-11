import { describe, expect, test, vi, beforeEach } from 'vitest';

/*
 * #646 P1-1: 内蔵フォームが Idempotency-Key を必ず送ることを見張る。
 *
 * サーバはキー無しの送信を 400 で断る。つまりこのヘッダが落ちると、内蔵
 * フォームからの回答は全部通らなくなる。それでいて、この経路は fetch へ
 * ヘッダの器を直に渡しているだけなので、行を消しても型検査は通る。
 * (LIFF 側は submitForm の必須引数になっているので型で落ちる。)
 * 逆変異: postFormSubmit の headers 行を消すと、この試験だけが赤くなる。
 */

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('location', { origin: 'https://example.test', search: '' } as never);
vi.stubGlobal('liff', {
  init: async () => {}, isLoggedIn: () => true, login: () => {},
  getProfile: async () => ({ userId: 'U1', displayName: 'テスト' }),
  getIDToken: () => 'id-token', isInClient: () => false, closeWindow: () => {},
} as never);

const { postFormSubmit } = await import('./form.js');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  }));
});

describe('内蔵フォームの送信', () => {
  test('Idempotency-Key を必ず付ける（落とすと全送信が 400 になる）', async () => {
    await postFormSubmit('/api/forms/form-1/submit', { data: {} }, 'key-abc');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-abc');
  });
});
