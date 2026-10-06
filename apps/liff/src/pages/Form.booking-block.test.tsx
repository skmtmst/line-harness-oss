// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FormLayout } from '@line-crm/shared';
import Form from './Form.js';

/**
 * 「予約を入れる」ブロック（g9osGN）。
 * - メニュー・担当・日にち→時刻の順に空き枠から選ぶ
 * - 回答の送信後に予約の受け口で確保する（未承認で入り、店が承認する）
 * - 予約だけ失敗しても回答は残し、取り直し・選び直しを出す
 */
vi.mock('../lib/api.js', () => ({
  api: {
    getForm: vi.fn(),
    getMyLatestFormAnswer: vi.fn(),
    submitForm: vi.fn(),
    uploadFormFile: vi.fn(),
    postalSearch: vi.fn(),
    menus: vi.fn(),
    staffOf: vi.fn(),
    availability: vi.fn(),
    createRequest: vi.fn(),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));

vi.mock('@line/liff', () => ({
  default: { closeWindow: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
const getForm = vi.mocked(api.getForm);
const submitForm = vi.mocked(api.submitForm);
const menus = vi.mocked(api.menus);
const staffOf = vi.mocked(api.staffOf);
const availability = vi.mocked(api.availability);
const createRequest = vi.mocked(api.createRequest);

function layout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [
      {
        id: 's1',
        name: '次回',
        blocks: [
          {
            id: 'b1', kind: 'input', type: 'booking', name: '来店予約',
            label: '次回のご希望の日時を選んでください', required: true,
            booking: { menuId: 'm1', staffId: 's1', daysAhead: 14 },
          },
        ],
      },
    ],
    options: {
      pageTitle: '来店アンケート',
      sectionHeader: 'pageNumber',
      confirmDialog: { enabled: false },
    },
  };
}

function setup() {
  getForm.mockResolvedValue({
    id: 'f1',
    name: '来店アンケート',
    description: '',
    layout: layout(),
    isActive: true,
  });
  menus.mockResolvedValue({
    menus: [{
      id: 'm1', name: 'トリミング（小型犬）', category_label: null, description: null,
      duration_minutes: 105, buffer_after_minutes: 0, base_price: 0, sort_order: 0,
    }],
  });
  // 枠の日は「今日の3日後」にする（選べる期間14日の内側で固定）。
  const day = new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10);
  availability.mockResolvedValue({
    by_staff: [
      {
        staff_id: 's1',
        display_name: '花子',
        slots: [
          { date: day, start: '10:00', end: '11:45' },
          { date: day, start: '13:00', end: '14:45' },
        ],
      },
    ],
  });
  render(
    <MemoryRouter initialEntries={['/forms/f1?liffId=test']}>
      <Routes>
        <Route path="/forms/:id" element={<Form />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('予約を入れる', () => {
  it('空き枠を選んで送ると回答の後に予約を確保する', async () => {
    setup();
    expect(await screen.findByText('トリミング（小型犬）・105分')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '13:00' }));
    expect(await screen.findByText(/を選んでいます/)).toBeTruthy();
    submitForm.mockResolvedValue({ status: 200, body: { success: true, data: {} } });
    createRequest.mockResolvedValue({ booking_id: 'bk1', status: 'requested' });
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('送信しました')).toBeTruthy();
    expect(createRequest).toHaveBeenCalledOnce();
    const [body, key] = createRequest.mock.calls[0];
    expect(body.menu_id).toBe('m1');
    expect(body.staff_id).toBe('s1');
    expect(typeof body.starts_at).toBe('string');
    expect(typeof key).toBe('string');
    const sent = submitForm.mock.calls[0][1].data['来店予約'] as Record<string, string>;
    expect(sent.menuId).toBe('m1');
  });

  it('予約だけ失敗しても回答は残し、取り直しを出す', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
    submitForm.mockResolvedValue({ status: 200, body: { success: true, data: {} } });
    const err = new Error('API 409') as Error & { status: number; body: unknown };
    err.status = 409;
    err.body = { error: 'slot_not_available' };
    createRequest.mockRejectedValue(err);
    fireEvent.click(screen.getByRole('button', { name: '送信する' }));
    expect(await screen.findByText('選んだ枠が埋まりました。日時を選び直してください。')).toBeTruthy();
    // 同じキーで取り直す
    createRequest.mockResolvedValue({ booking_id: 'bk1', status: 'requested' });
    fireEvent.click(screen.getByRole('button', { name: '予約を取り直す' }));
    await screen.findByText('送信しました');
    expect(createRequest).toHaveBeenCalledTimes(2);
    expect(createRequest.mock.calls[0][1]).toBe(createRequest.mock.calls[1][1]);
  });

  it('予約連携のブロックの外枠に板の印（g9osGN）が付いている', async () => {
    setup();
    // メニューの札が出たら枠が描かれている。外枠に印が無いと数に入らない。
    expect(await screen.findByText('トリミング（小型犬）・105分')).toBeTruthy();
    const frame = document.querySelector('[data-design-node="g9osGN"]');
    expect(frame).toBeTruthy();
    expect(frame?.textContent).toContain('トリミング（小型犬）');
  });
});
