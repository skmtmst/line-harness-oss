// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Research from './Research.js';
const researchForm = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.js', () => ({ api: { researchForm } }));
afterEach(() => { cleanup(); researchForm.mockReset(); });
function Probe() { const location = useLocation(); return <p>{location.pathname + location.search}</p>; }
function mount() { render(<MemoryRouter initialEntries={['/research/r1?liffId=account1']}><Routes>
  <Route path="/research/:id" element={<Research />} /><Route path="/forms/:id" element={<Probe />} />
</Routes></MemoryRouter>); }
test('認証済みアカウントのフォームへ移動する', async () => {
  researchForm.mockResolvedValue({ formId: 'form1' }); mount();
  expect(await screen.findByText('/forms/form1?liffId=account1')).toBeTruthy(); expect(researchForm).toHaveBeenCalledWith('r1');
});
test('取得失敗は再読込でき、回答画面へ進む', async () => {
  researchForm.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ formId: 'form1' }); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('/forms/form1?liffId=account1')).toBeTruthy(); expect(researchForm).toHaveBeenCalledTimes(2);
});
