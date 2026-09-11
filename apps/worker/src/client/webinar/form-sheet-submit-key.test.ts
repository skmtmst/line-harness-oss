// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/*
 * #646 P1-1: webinar の申込フォームが Idempotency-Key を必ず送ることを見張る。
 *
 * サーバはキー無しの送信を 400 で断る。つまりこのヘッダが落ちると、webinar
 * からの申込は全部通らなくなる。それでいてこの経路は fetch へヘッダの器を
 * 直に渡しているだけなので、行を消しても型検査は通る。
 * (LIFF 側は submitForm の必須引数なので型で落ちる。内蔵フォームは
 *  form.submit-key.test.ts が見張る。)
 *
 * 送信は FormSheet の中の関数なので、実際に描いてボタンを押し、fetch へ
 * 渡ったヘッダを見る。文字列を grep するだけの契約試験では、ヘッダの行が
 * 消えたことを捕まえられない。
 *
 * 逆変異: 1056 行目あたりの 'Idempotency-Key': key を消すと、この試験だけが
 * 赤くなる。
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { FormSheet } = await import('./main.js');

const ctx = { liffId: 'liff-1', lineUserId: 'U1', idToken: 'id-token' };
const cta = {
  id: 'cta-1', atSeconds: 0, kind: 'form' as const, title: '申込',
  body: null, buttonLabel: '申し込む', autoOpen: false,
  formId: 'form-1', url: null,
};
const def = {
  id: 'form-1', name: '相談申込', description: null,
  fields: [], isActive: true,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { complete: true } }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 送信ボタンを押して、/submit へ渡った fetch の init を返す。 */
async function submitAndCaptureInit(): Promise<RequestInit | undefined> {
  await act(async () => {
    root.render(
      createElement(FormSheet, {
        sheet: { cta, phase: 'form' as const, def },
        ctx,
        onFunnelEvent: () => {},
        onClose: () => {},
        onSubmitted: () => {},
      }),
    );
  });

  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('回答を送信'),
  );
  expect(button, '送信ボタンが描かれていること').toBeTruthy();
  expect(button!.disabled, '必須項目が無いので押せること').toBe(false);

  await act(async () => {
    button!.click();
  });

  const call = fetchMock.mock.calls.find(
    ([url]) => typeof url === 'string' && url.includes('/submit'),
  );
  expect(call, '/submit を呼んでいること').toBeTruthy();
  return call![1] as RequestInit | undefined;
}

describe('webinar の申込フォームの送信', () => {
  test('Idempotency-Key を必ず付ける（落とすと全送信が 400 になる）', async () => {
    const init = await submitAndCaptureInit();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeTruthy();
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
