// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/user-message.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/user-message.js')>()), logFailure: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { bookingWaitlists: vi.fn(), cancelWaitlist: vi.fn(), registerWaitlist: vi.fn(), seatWaitlists: vi.fn() } }));
vi.mock('./waitlist-offer-sheet.js', () => ({ default: ({ id }: { id: string }) => <div role="dialog" aria-label="案内">{id}</div> }));
const { api } = await import('../lib/api.js');
const { default: WaitlistSection } = await import('./waitlist-section.js');

const base = { staff_id: 's1', menu_id: 'm1', hold_minutes: 30, created_at: '2026-10-15T01:00:00.000Z', menu_name: 'トリミング（小型犬）', staff_name: '佐々木' };
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('予約の履歴 › キャンセル待ち中（B3・F-6）', () => {
  it('空きが出た人には残り時間と［予約する］、待っている人には取り消しだけ（先着・順番を出す）', async () => {
    vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [
      { ...base, id: 'w1', starts_at: '2026-11-20T05:00:00.000Z', status: 'invited', hold_expires_at: new Date(Date.now() + 18 * 60_000 - 500).toISOString(), position: 1 },
      { ...base, id: 'w2', starts_at: '2026-11-22T01:00:00.000Z', status: 'waiting', hold_expires_at: null, position: 3 },
    ] as never });
    render(<WaitlistSection />);
    expect(await screen.findByText('キャンセル待ち中（2）')).toBeTruthy();
    expect(screen.getByText('空きが出ました。あと 18 分 お取りしています')).toBeTruthy();
    expect(screen.getByText('1 番目')).toBeTruthy();
    expect(screen.getByText('空いたら LINE でお知らせします')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'キャンセル待ちを取り消す' }).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '予約する' }));
    expect(screen.getByRole('dialog', { name: '案内' }).textContent).toBe('w1');
  });

  it('時間切れは理由と［もう一度キャンセル待ちをする］。上限 3 件に当たったら言葉で出す', async () => {
    vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [{ ...base, id: 'w3', starts_at: '2026-11-20T05:00:00.000Z', status: 'finished', hold_expires_at: '2026-10-16T02:00:00.000Z', hold_minutes: 18 }] as never });
    vi.mocked(api.registerWaitlist).mockRejectedValue(Object.assign(new Error('422'), { body: { error: 'waitlist_limit' } }));
    render(<WaitlistSection />);
    expect(await screen.findByText('時間切れ')).toBeTruthy();
    expect(screen.getByText('18 分のうちにご予約がなかったため、次の方へお回ししました。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度キャンセル待ちをする' }));
    await waitFor(() => expect(api.registerWaitlist).toHaveBeenCalledWith({ staff_id: 's1', menu_id: 'm1', starts_at: '2026-11-20T05:00:00.000Z' }));
    expect((await screen.findByRole('alert')).textContent).toContain('3 件まで');
  });

  it('待ちが無い人には何も出さない', async () => {
    vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [] });
    const { container } = render(<WaitlistSection />);
    await waitFor(() => expect(api.bookingWaitlists).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
