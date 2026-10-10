// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MenuItem, StaffItem } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { menus: vi.fn(), staffOf: vi.fn() } }));
vi.mock('../lib/use-wide-viewport.js', () => ({ useWideViewport: () => false }));
import { api } from '../lib/api.js';
import MenuList from './MenuList.js';
import StaffList from './StaffList.js';
import Confirm from './Confirm.js';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
test.each([['inquiry',0,'お問い合わせ'],['inquiry',5000,'お問い合わせ'],['free',5000,'無料'],['fixed',5000,'¥5,000'],['fixed',0,'¥0']] as const)('%s %sの料金をメニュー・担当・確認で同じ意味で表示する', async (mode, amount, expected) => {
  const menu = { id:'m', name:'相談', description:null, category_label:null, duration_minutes:60, base_price: amount, price_mode:mode } as MenuItem;
  const staff = { id:'s', display_name:'担当', duration_minutes:60, price: menu.base_price, price_mode:mode } as StaffItem;
  vi.mocked(api.menus).mockResolvedValue({ menus:[menu] });
  vi.mocked(api.staffOf).mockResolvedValue({ staff:[staff] });
  render(<MenuList selectedId={null} onSelect={() => {}} />);
  expect(await screen.findByText(expected)).toBeTruthy(); cleanup();
  render(<StaffList menu={menu} selectedId={null} onSelect={() => {}} />);
  expect(await screen.findByText(new RegExp(expected))).toBeTruthy(); cleanup();
  render(<Confirm menu={menu} staff={staff} slot={{ date:'2026-10-10',start:'10:00' }} autoConfirm={false} onBack={() => {}} onSubmitted={() => {}} />);
  expect(screen.getByText(new RegExp(expected))).toBeTruthy();
});
