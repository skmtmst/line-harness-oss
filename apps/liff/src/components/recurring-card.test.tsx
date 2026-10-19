// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MenuItem, StaffItem } from '../lib/api.js';

vi.mock('../lib/user-message.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/user-message.js')>()), logFailure: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { seriesPreview: vi.fn() } }));
const { api } = await import('../lib/api.js');
const { default: RecurringCard } = await import('./recurring-card.js');

const menu = { id: 'm1', name: 'トリミング', recurring: { enabled: true, max_count: 12 } } as unknown as MenuItem;
const staff = { id: 's1' } as StaffItem;
const week = (i: number) => new Date(Date.parse('2026-11-20T05:00:00.000Z') + i * 7 * 86_400_000).toISOString();
const occ = [0, 1, 2, 3].map((i) => ({ index: i, starts_at: week(i), available: i !== 2, ...(i === 2 ? { reason: 'お休み' } : {}), alternatives: i === 2 ? [new Date(Date.parse(week(2)) + 3_600_000).toISOString()] : [] }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('続けて予約（B4・お客さま）', () => {
  it('初めはオフで、何も確かめない。オンにすると取れない回を一覧で見せ、取れた回だけで作る（黙って作らない）', async () => {
    vi.mocked(api.seriesPreview).mockResolvedValue({ occurrences: occ });
    const onChange = vi.fn();
    render(<RecurringCard menu={menu} staff={staff} startsAt={week(0)} onChange={onChange} />);
    expect(api.seriesPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: '毎週この時間で続ける' }));
    expect(await screen.findByText(/お休み/)).toBeTruthy();
    expect(api.seriesPreview).toHaveBeenCalledWith({ menu_id: 'm1', staff_id: 's1', starts_at: week(0), freq: 'weekly', count: 4 });
    expect(screen.getByText('取れない回は飛ばして 3 回で予約します。1 回ずつ取り消せます。')).toBeTruthy();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ count: 4, made: 3, choices: [
      { index: 0, action: 'keep' }, { index: 1, action: 'keep' }, { index: 2, action: 'skip' }, { index: 3, action: 'keep' },
    ] }));
  });

  it('［近い時間にする］を選ぶと、その回を近い時間で作る（4 回）', async () => {
    vi.mocked(api.seriesPreview).mockResolvedValue({ occurrences: occ });
    const onChange = vi.fn();
    render(<RecurringCard menu={menu} staff={staff} startsAt={week(0)} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: '毎週この時間で続ける' }));
    fireEvent.click(await screen.findByRole('button', { name: '近い時間にする' }));
    fireEvent.click(await screen.findByRole('button', { name: /12\/4（金）15:00/ }));
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toMatchObject({ made: 4 }));
    expect(onChange.mock.lastCall?.[0].choices[2]).toMatchObject({ action: 'alternative', alternative_starts_at: expect.any(String) });
  });

  it('回数の上限はメニューの上限（お客さまは 12 回まで）', async () => {
    vi.mocked(api.seriesPreview).mockResolvedValue({ occurrences: occ });
    render(<RecurringCard menu={{ ...menu, recurring: { enabled: true, max_count: 99 } }} staff={staff} startsAt={week(0)} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: '毎週この時間で続ける' }));
    for (let i = 0; i < 20; i += 1) fireEvent.click(await screen.findByRole('button', { name: '回数を増やす' }));
    expect(screen.getByText('12 回')).toBeTruthy();
  });
});
