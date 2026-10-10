import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import EntryRouteCoupon from './pages/EntryRouteCoupon.js';
import { setLiffContext } from './lib/liff-auth.js';
import './index.css';

export function mountEntryRouteCoupon(container: HTMLElement, context: { liffId: string; lineUserId: string; idToken: string }): void {
  setLiffContext(context);
  document.body.classList.add('sb-active');
  container.innerHTML = '';
  createRoot(container).render(<StrictMode><BrowserRouter><EntryRouteCoupon /></BrowserRouter></StrictMode>);
}
