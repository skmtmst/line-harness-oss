import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const liffMock = vi.hoisted(() => ({ isInClient: vi.fn(() => true), closeWindow: vi.fn() }));
vi.mock('@line/liff', () => ({ default: liffMock }));
vi.mock('../lib/api.js', () => ({ api: { liffConfig: () => Promise.resolve({ data: null }) } }));

import NotFound, { closeOrBackToLine } from './NotFound.js';

/** ★V8 見つからない画面（板 aLU3r）。以前は灰色の文字1行だけで戻る道が無かった。 */
describe('LIFF の見つからない画面', () => {
  it('題・説明・LINE に戻る・閉じる を出す', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('data-design-node="aLU3r"');
    expect(html).toContain('ページが見つかりません');
    expect(html).toContain('お店からのメッセージのリンクを、もう一度開いてください。');
    expect(html).toContain('LINE に戻る');
    expect(html).toContain('閉じる');
  });

  it('LINE の中では、どちらのボタンも LIFF を閉じて LINE に戻る', () => {
    closeOrBackToLine('line');
    closeOrBackToLine('close');
    expect(liffMock.closeWindow).toHaveBeenCalledTimes(2);
  });

  it('どの住所にも当たらないときは、この画面へ送る', () => {
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
    expect(app).toMatch(/<Route path="\*" element={<NotFound \/>} \/>/);
    expect(app).not.toContain('ページが見つかりませんでした');
  });
});
