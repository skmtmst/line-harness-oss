import liff from '@line/liff';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Research from './pages/Research.js';
import Form from './pages/Form.js';
import { setLiffContext } from './lib/liff-auth.js';
import './index.css';
import './research-entry.css';

/** Worker の公開URLも、LIFF の回答フォームそのものへつなぐ。 */
export async function mountResearch(container: HTMLElement, context: { liffId: string; lineUserId: string; idToken: string }, researchId: string): Promise<void> {
  await liff.init({ liffId: context.liffId });
  setLiffContext(context);
  document.body.classList.add('research-active');
  createRoot(container).render(<MemoryRouter initialEntries={[`/research/${encodeURIComponent(researchId)}${window.location.search}`]}>
    <Routes><Route path="/research/:id" element={<Research />} /><Route path="/forms/:id" element={<Form />} /></Routes>
  </MemoryRouter>);
}
