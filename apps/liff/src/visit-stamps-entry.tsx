import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import VisitStamps from './pages/VisitStamps.js';
import { setLiffContext } from './lib/liff-auth.js';
import './index.css';

/** 別URLへの転送を挟まず、同じLIFF認証・店・APIで既存画面を開く。 */
export function mountVisitStamps(container: HTMLElement, context: { liffId: string; lineUserId: string; idToken: string }): void {
  setLiffContext(context);
  document.body.classList.add('sb-active');
  container.innerHTML = '';
  createRoot(container).render(<StrictMode><BrowserRouter><VisitStamps /></BrowserRouter></StrictMode>);
}
