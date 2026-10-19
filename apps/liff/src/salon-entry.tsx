import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Booking from './pages/booking.js';
import BookingHistory from './pages/booking-history.js';
import { setLiffContext } from './lib/liff-auth.js';
import { setCustomerLiffRuntime, type CustomerLiffRuntime } from './lib/liff-runtime.js';
import { readUrlState } from './lib/salon-url-state.js';
import './embedded.css';

let root: Root | null = null;
export function unmountSalonBooking(): void {
  root?.unmount(); root = null;
  setCustomerLiffRuntime(null);
  document.body.classList.remove('sb-active');
}

/** 配備で開く入口もLIFF単体も、同じBooking/BookingHistoryと共通部品を使う。 */
export function mountSalonBooking(container: HTMLElement, context: { liffId: string; lineUserId: string; idToken: string; sdk?: CustomerLiffRuntime }): void {
  unmountSalonBooking();
  setLiffContext(context);
  document.body.classList.add('sb-active');
  const history = readUrlState().view === 'history';
  container.innerHTML = '';
  root = createRoot(container);
  root.render(<StrictMode><BrowserRouter><Routes>
    <Route path="/booking" element={<Booking />} />
    <Route path="/booking/history" element={<BookingHistory />} />
    <Route path="*" element={history ? <BookingHistory /> : <Booking />} />
  </Routes></BrowserRouter></StrictMode>);
}
