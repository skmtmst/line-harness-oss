// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog.js';

/**
 * 確認窓のキーボード操作と折れ方の描画試験。
 * Esc・フォーカスは文面を読むだけでは確かめられないので、
 * 実際に描いてキーを送る (happy-dom)。
 */

afterEach(cleanup);

const TITLE = '「豆まき大会」の予約をキャンセルしますか？';
const DESCRIPTION = '2/3 10:00・広場の予約を取り消します。';

function cancelButton(): HTMLElement {
  return screen.getByRole('button', { name: 'やめる' });
}

describe('Esc で閉じる', () => {
  it('開いている間の Escape で onCancel が呼ばれる', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title={TITLE} description={DESCRIPTION} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('処理中 (busy) の Escape では閉じない', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        title={TITLE}
        description={DESCRIPTION}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('フォーカス', () => {
  it('開いたら安全な方 (「やめる」) へ移る', () => {
    render(
      <>
        <button type="button">外のボタン</button>
        <ConfirmDialog
          open
          title={TITLE}
          description={DESCRIPTION}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </>,
    );
    expect(cancelButton()).toBe(document.activeElement);
  });

  it('Tab が窓の外へ出ない (行き止まりで折り返す)', () => {
    render(
      <>
        <button type="button">外のボタン</button>
        <ConfirmDialog
          open
          title={TITLE}
          description={DESCRIPTION}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </>,
    );
    const confirm = screen.getByRole('button', { name: '実行する' });
    // 末尾で Tab → 先頭へ折り返す。
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancelButton()).toBe(document.activeElement);
    // 先頭で Shift+Tab → 末尾へ折り返す。
    fireEvent.keyDown(cancelButton(), { key: 'Tab', shiftKey: true });
    expect(confirm).toBe(document.activeElement);
    // 折り返しのあとも窓の中にいる。
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  });

  it('閉じたら開く前のボタンへ戻る', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            予約を開く
          </button>
          <ConfirmDialog
            open={open}
            title={TITLE}
            description={DESCRIPTION}
            onCancel={() => setOpen(false)}
            onConfirm={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: '予約を開く' });
    opener.focus();
    fireEvent.click(opener);
    expect(cancelButton()).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toBe(document.activeElement);
  });
});

describe('題と本文の折れ方', () => {
  it('文節で折れる (auto-phrase。anywhere は使わない)', () => {
    render(<ConfirmDialog open title={TITLE} description={DESCRIPTION} onCancel={() => {}} />);
    for (const text of [TITLE, DESCRIPTION]) {
      const el = screen.getByText(text);
      expect(el.className).toContain('auto-phrase');
      expect(el.className).not.toContain('anywhere');
    }
  });
});
