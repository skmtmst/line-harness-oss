// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { WebinarState } from '../lib/api.js';

/**
 * 監査 L7・L8・L9（ウェビナー）。
 * L7 日本語の変換を確定する Enter ではコメントを送らない。
 * L8 開始時刻を過ぎた後の読み直しは、取得中に重ねず、失敗したら止める。
 * L9 コメントが送れなかったら行に出し、書いた文を入力欄へ戻す。
 */

vi.mock('@line/liff', () => ({ default: { isInClient: () => false, openWindow: vi.fn() } }));
vi.mock('../lib/api.js', () => ({
  api: {
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    webinarState: vi.fn(),
    webinarHeartbeat: vi.fn().mockResolvedValue({ ok: true }),
    webinarComment: vi.fn(),
    webinarCtaClick: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const { default: Webinar } = await import('./Webinar.js');
const webinarState = vi.mocked(api.webinarState);
const webinarComment = vi.mocked(api.webinarComment);

const LIVE: WebinarState = {
  live: true,
  title: '秋の説明会',
  durationSeconds: 3600,
  sessionStartAt: 1_800_000_000,
  offsetSeconds: 10,
  playlistUrl: 'https://example.invalid/a.m3u8',
  cta: null,
  comments: [],
};

function open() {
  render(
    <MemoryRouter initialEntries={['/webinar/w1']}>
      <Routes>
        <Route path="/webinar/:slug" element={<Webinar />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('監査 L7：変換中の Enter では送らない', () => {
  it('isComposing・keyCode 229 の Enter は送らず、ふつうの Enter で送る', async () => {
    webinarState.mockResolvedValue(LIVE);
    webinarComment.mockResolvedValue({ ok: true });
    open();
    const input = await screen.findByRole('textbox', { name: 'コメントを書く' });
    fireEvent.change(input, { target: { value: 'こんにちは' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(webinarComment).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(webinarComment).toHaveBeenCalledTimes(1);
    expect(webinarComment.mock.calls[0]![3]).toBe('こんにちは');
  });
});

describe('共通の頭・読み込み・失敗の表示', () => {
  it('待っている間も頭を出し、共通の読み込み表示で知らせる', () => {
    webinarState.mockImplementation(() => new Promise(() => {}));
    open();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('読めなかったら頭と共通の失敗表示を残し、読み直して配信へ戻れる', async () => {
    webinarState.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(LIVE);
    open();
    expect(await screen.findByText('読み込めませんでした')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
    const input = await screen.findByRole('textbox', { name: 'コメントを書く' });
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(document.title).toBe('秋の説明会 | musubo');
    fireEvent.change(input, { target: { value: '質問です' } });
    expect(screen.getByText('4/500文字')).toBeTruthy();
  });
});

describe('監査 L9：送れなかったコメント', () => {
  it('行に「送れませんでした」を出し、書いた文を入力欄へ戻す', async () => {
    webinarState.mockResolvedValue(LIVE);
    webinarComment.mockRejectedValue(new TypeError('Failed to fetch'));
    open();
    const input = (await screen.findByRole('textbox', { name: 'コメントを書く' })) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '質問です' } });
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('（送れませんでした）')).toBeTruthy();
    expect(input.value).toBe('質問です');
    webinarComment.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: '再送する' }));
    await waitFor(() => expect(webinarComment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('（送れませんでした）')).toBeNull());
    expect(webinarComment.mock.calls[1]![3]).toBe('質問です');
    expect(input.value).toBe('');
  });
});

/** 1秒ずつ進める（React の更新を毎秒反映させる）。 */
async function advanceSeconds(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe('監査 L8：開始時刻を過ぎた後の読み直し', () => {
  const WAIT_PAST = (): WebinarState => ({
    live: false,
    title: '秋の説明会',
    nextSessionAt: Math.floor(Date.now() / 1000) - 5,
  });

  it('取得が遅れている間は重ねて送らない', async () => {
    vi.useFakeTimers();
    webinarState.mockResolvedValueOnce(WAIT_PAST());
    webinarState.mockImplementation(() => new Promise(() => {}));
    open();
    await advanceSeconds(10);
    // 最初の1回と、開始時刻を過ぎたあとの1回だけ（返ってこない間は重ねない）。
    expect(webinarState).toHaveBeenCalledTimes(2);
  });

  it('失敗したら自動の読み直しを止め、「もう一度読み込む」を出す', async () => {
    vi.useFakeTimers();
    webinarState.mockResolvedValueOnce(WAIT_PAST());
    webinarState.mockRejectedValue(Object.assign(new Error('API 500'), { status: 500 }));
    open();
    await advanceSeconds(10);
    expect(webinarState).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy();
  });
});
