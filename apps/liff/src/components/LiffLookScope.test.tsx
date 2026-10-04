// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * 予約の画面の包み (M2)。店の見た目を data-liff-theme と CSS 変数で渡す。
 * 設定の読み口は /api/liff/booking/settings (M3 が欄を足す)。
 */

vi.mock('../lib/api.js', () => ({
  api: { bookingSettings: vi.fn() },
}));
vi.mock('../lib/user-message.js', () => ({ logFailure: vi.fn() }));

async function renderScope(
  props: { className?: string; designNode?: string } = {},
  settings: unknown = { liff_date_view: 'list', booking_window_days: 60 },
) {
  // 包みは読んだ見た目をモジュールに持つ。試験ごとに作り直す。
  vi.resetModules();
  const { default: LiffLookScope } = await import('./LiffLookScope.js');
  const { api } = await import('../lib/api.js');
  const bookingSettings = vi.mocked(api.bookingSettings);
  if (settings instanceof Promise) {
    bookingSettings.mockImplementation(() => settings as never);
  } else if (settings instanceof Error) {
    bookingSettings.mockRejectedValue(settings);
  } else {
    bookingSettings.mockResolvedValue(settings as never);
  }
  render(
    <LiffLookScope className={props.className} designNode={props.designNode}>
      <p>中身</p>
    </LiffLookScope>,
  );
  const scope = () => screen.getByText('中身').parentElement!;
  return { bookingSettings, scope };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LiffLookScope', () => {
  it('設定が読めるまでは今の見た目 (⑤) で出す', async () => {
    const { scope } = await renderScope(
      { className: 'min-h-screen bg-canvas' },
      new Promise(() => {}),
    );
    expect(scope().getAttribute('data-liff-theme')).toBe('line');
  });

  it('店の型と色を包みに載せる', async () => {
    const { scope } = await renderScope(
      { className: 'min-h-screen bg-canvas' },
      {
        liff_date_view: 'list',
        booking_window_days: 60,
        liff_theme: 'night',
        shop_primary_color: '#123d2f',
        shop_background_color: '#0f1c33',
        shop_heading_font: 'mincho',
      },
    );
    await vi.waitFor(() => {
      expect(scope().getAttribute('data-liff-theme')).toBe('night');
    });
    expect(scope().style.getPropertyValue('--color-liff-primary')).toBe('#123d2f');
    expect(scope().style.getPropertyValue('--color-canvas')).toBe('#0f1c33');
    expect(scope().style.getPropertyValue('--liff-font-heading')).toContain('Shippori Mincho');
    // 濃い緑の上は白字が読める。
    expect(scope().style.getPropertyValue('--liff-on-primary')).toBe('#ffffff');
  });

  it('設定が読めなくても止めず、今の見た目のまま出す', async () => {
    const { bookingSettings, scope } = await renderScope(
      { className: 'min-h-screen bg-canvas' },
      new Error('offline'),
    );
    await vi.waitFor(() => {
      expect(bookingSettings).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(scope().getAttribute('data-liff-theme')).toBe('line');
    });
  });

  it('板の札は受け渡す (qa-shots と突き合わせる)', async () => {
    await renderScope({
      className: 'min-h-screen bg-ground',
      designNode: 'gVjiC',
    });
    await vi.waitFor(() => {
      expect(
        screen.getByText('中身').parentElement!.getAttribute('data-design-node'),
      ).toBe('gVjiC');
    });
  });
});
