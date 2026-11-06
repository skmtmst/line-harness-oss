// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DateTimePicker from '../components/date-time-picker.js';
import Confirm from '../components/confirm.js';
import Form from './form.js';
import type { MenuItem, StaffItem } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: {
    availability: vi.fn().mockResolvedValue({ by_staff: [], closed_dates: [] }),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 30 }),
    cancellationPreview: vi.fn().mockResolvedValue({ enabled: false, version: 0, freeUntil: null, afterPercent: 50, noShowPercent: 100, price: 0, deposit: null }),
    entitlements: vi.fn().mockResolvedValue([]),
    getForm: vi.fn().mockResolvedValue({
      id: 'form', name: 'アンケート', description: null, isActive: true,
      layout: { version: 2, header: [], sections: [{ id: 'section', name: '回答', blocks: [{ id: 'answer', kind: 'input', type: 'text', name: '要望', label: 'ご要望' }] }], options: { pageTitle: 'アンケート' } },
    }),
    getMyLatestFormAnswer: vi.fn().mockResolvedValue(null),
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));
vi.mock('@line/liff', () => ({ default: { getAccessToken: vi.fn() } }));

const menu: MenuItem = { id: 'menu', name: '相談', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 0, sort_order: 0 };
const staff: StaffItem = { id: 'staff', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 0, duration_minutes: 60 };
let viewport = 375;
const listeners = new Set<(event: MediaQueryListEvent) => void>();
function resize(width: number) {
  viewport = width;
  act(() => listeners.forEach(listener => listener({ matches: viewport >= 414 } as MediaQueryListEvent)));
}
beforeEach(() => {
  localStorage.clear();
  listeners.clear();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    media: query, matches: query === '(min-width: 414px)' && viewport >= 414,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { if (query === '(min-width: 414px)') listeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cases = [
  {
    label: '日時の週表示', narrow: 'M2p63S', wide: 'xvtSz',
    draw: () => render(createElement(DateTimePicker, { menu, staff, selected: null, onSelect: vi.fn(), onConfirm: vi.fn(), onBackToStaff: vi.fn() })),
  },
  {
    label: '予約内容の確認', narrow: 'gLReL', wide: 'uZqMA',
    draw: () => render(createElement(Confirm, { menu, staff, slot: { date: '2099-01-01', start: '10:00' }, autoConfirm: true, onSubmitted: vi.fn() })),
  },
  {
    label: '回答フォーム', narrow: 'B8rCt', wide: 'wPfqW',
    draw: () => render(createElement(MemoryRouter, { initialEntries: ['/forms/form?liffId=test'] },
      createElement(Routes, null, createElement(Route, { path: '/forms/:id', element: createElement(Form) })))),
  },
];

describe('画面幅に応じて照合用の目印を描画する', () => {
  for (const example of cases) {
    it.each([375, 413, 414, 768])(`${example.label}：幅%sで対応する目印を出す`, async width => {
      viewport = width;
      const view = example.draw();
      const expected = width >= 414 ? example.wide : example.narrow;
      await waitFor(() => expect(view.container.querySelector(`[data-design-node="${expected}"]`)).not.toBeNull());
      expect(view.container.querySelector(`[data-design-node="${width >= 414 ? example.narrow : example.wide}"]`)).toBeNull();
    });
    it(`${example.label}：表示したまま境界を往復すると目印も切り替わる`, async () => {
      viewport = 413;
      const view = example.draw();
      await waitFor(() => expect(view.container.querySelector(`[data-design-node="${example.narrow}"]`)).not.toBeNull());
      resize(414);
      await waitFor(() => expect(view.container.querySelector(`[data-design-node="${example.wide}"]`)).not.toBeNull());
      resize(413);
      await waitFor(() => expect(view.container.querySelector(`[data-design-node="${example.narrow}"]`)).not.toBeNull());
      view.unmount();
      expect(listeners.size).toBe(0);
    });
  }
});
