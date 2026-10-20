import { describe, expect, test, vi, beforeEach } from 'vitest';
import { toFormIdempotencyKey } from '@line-crm/shared';

/*
 * #646 P1-1: 内蔵フォームが Idempotency-Key を必ず送ることを見張る。
 *
 * サーバはキー無しの送信を 400 で断る。つまりこのヘッダが落ちると、内蔵
 * フォームからの回答は全部通らなくなる。送信ヘッダは共有部品
 * (`buildFormSubmitHeaders`) 経由で組み立てる(#729)。キーの渡し忘れは
 * branded 型の必須引数で型が落ちる。
 * 逆変異: 共有関数の呼び出しを外す・共有関数がキーを落とすと赤くなる。
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
    // #729: postFormSubmit は共有の branded キーを取る。値は UUID 形にする
    // (サーバも非UUIDを 400 で断る)。見張る点は同じで、fetch へ渡った
    // ヘッダにキー(共有関数経由)が載ること。
    const key = toFormIdempotencyKey('123e4567-e89b-12d3-a456-426614174000');
    await postFormSubmit('/api/forms/form-1/submit', { data: {} }, key);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('123e4567-e89b-12d3-a456-426614174000');
  });
});
