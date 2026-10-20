// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MenuItem } from '../lib/api.js';

const net = vi.hoisted(() => ({ menus: vi.fn(), staffOf: vi.fn(), storePhotos: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: net }));
const { default: MenuList } = await import('./menu-list.js');
const { default: StaffList } = await import('./staff-list.js');
const { default: StorePhotos } = await import('./booking-store-photos.js');
const menu: MenuItem = { id: 'm', name: 'カット', category_label: null, description: null, duration_minutes: 30, buffer_after_minutes: 0, base_price: 1000, sort_order: 0, photo_url: 'https://worker.test/media/p/content' };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('メニュー写真を出し、写真のあるメニューも選べる。写真なしも予約できる', async () => {
  const noPhoto = { ...menu, id: 'n', name: '相談', photo_url: null };
  net.menus.mockResolvedValue({ menus: [menu, noPhoto] });
  const choose = vi.fn();
  const { container } = render(<MenuList selectedId={null} onSelect={choose} />);
  fireEvent.click(await screen.findByRole('button', { name: /カット/ }));
  expect(choose).toHaveBeenCalledWith(menu);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(menu.photo_url);
  fireEvent.click(screen.getByRole('button', { name: /相談/ }));
  expect(choose).toHaveBeenLastCalledWith(noPhoto);
});
it('担当の登録写真を優先し、外した担当は既存プロフィールの写真を保つ', async () => {
  net.staffOf.mockResolvedValue({ staff: [
    { id: 's', display_name: '山田', photo_url: '/media/new/content', profile_image_url: '/old-avatar', is_designation_optional: 0, price: 1000 },
    { id: 'n', display_name: '佐藤', photo_url: null, profile_image_url: '/existing-avatar', is_designation_optional: 0, price: 1000 },
  ] });
  const choose = vi.fn();
  const { container } = render(<StaffList menu={menu} selectedId={null} onSelect={choose} />);
  fireEvent.click(await screen.findByRole('button', { name: /山田/ }));
  expect(choose.mock.calls[0]?.[0].id).toBe('s');
  expect([...container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/media/new/content', '/existing-avatar']);
});
it('店の案内は保存した順・登録した写真だけを出す', async () => {
  net.storePhotos.mockResolvedValue([{ slot: 'waiting', url: '/media/w/content' }, { slot: 'exterior', url: '/media/e/content' }]);
  render(<StorePhotos />);
  const summary = await screen.findByText('お店の案内');
  fireEvent.click(summary);
  expect([...document.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['お店の待合', 'お店の外観']);
  expect(document.querySelectorAll('figure')).toHaveLength(2);
});
it('店の写真の読込失敗を空にせず、予約メニューの選択を残して読み直す', async () => {
  net.storePhotos.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ slot: 'interior', url: '/media/i/content' }]);
  render(<StorePhotos />);
  expect((await screen.findByRole('alert')).textContent).toContain('読み込めませんでした');
  fireEvent.click(screen.getByRole('button', { name: '写真を読み直す' }));
  await screen.findByText('お店の案内');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(document.querySelector('img')?.getAttribute('src')).toBe('/media/i/content');
});

it('公開写真0枚ならお店の案内ごと出さない', async () => {
  net.storePhotos.mockResolvedValue([]);
  render(<StorePhotos />);
  await waitFor(() => expect(net.storePhotos).toHaveBeenCalledOnce());
  expect(screen.queryByRole('region', { name: 'お店の案内' })).toBeNull();
  expect(screen.queryByText('お店の案内')).toBeNull();
});
it('小さい写真から拡大し、閉じると選んだ写真へ焦点を戻す', async () => {
  net.storePhotos.mockResolvedValue([{ slot: 'waiting', url: '/media/w/content' }, { slot: 'exterior', url: '/media/e/content' }]);
  render(<StorePhotos />);
  const opener = await screen.findByRole('button', { name: '外観の写真を大きく見る' });
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'お店の外観' });
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/media/e/content');
  expect(screen.getByRole('img', { name: 'お店の外観（拡大）' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
  fireEvent.click(screen.getByRole('button', { name: '待合の写真を大きく見る' }));
  expect(screen.getByRole('dialog', { name: 'お店の待合' }).querySelector('img')?.getAttribute('src')).toBe('/media/w/content');
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
