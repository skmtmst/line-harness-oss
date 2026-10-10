// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.js';
vi.mock('./pages/Booking.js', () => ({ default: () => <div>予約ページ</div> }));
vi.mock('./pages/BookingHistory.js', () => ({ default: () => <div>予約履歴</div> }));
vi.mock('./pages/Form.js', () => ({ default: () => <div>回答フォーム</div> }));
vi.mock('./pages/VisitStamps.js', () => ({ default: () => <div>来店スタンプ</div> }));
afterEach(cleanup);
test.each([
  ['/?page=salon-book&menu_id=menu-1', '予約ページ'],
  ['/?page=salon-book&view=history', '予約履歴'],
  ['/?page=form&id=form-1', '回答フォーム'],
  ['/?form=form-1', '回答フォーム'],
  ['/?page=visit-stamps&card=card-1', '来店スタンプ'],
  ['/?page=visit-stamps', '来店スタンプ'],
  ['/visit-stamps?card=card-1', '来店スタンプ'],
])('LIFFの入口を既存の画面へ振り分ける: %s', async (url, label) => {
  render(<MemoryRouter initialEntries={[url]}><App /></MemoryRouter>);
  expect(await screen.findByText(label)).toBeTruthy();
});
