// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Confirm from './Confirm.js';
import { api } from '../lib/api.js';
vi.mock('../lib/api.js', () => ({ api: { createRequest: vi.fn().mockResolvedValue({ booking_id: 'b1', status: 'confirmed' }) } }));
afterEach(cleanup);
it('メニューの質問で回答を集め、既定キャンセル期限を知らせて既存の予約へ送る', async () => {
  render(<Confirm menu={{ id: 'm1', name: '相談', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 0, sort_order: 0, intake_question: '相談したい内容を教えてください', cancel_deadline_hours_before: null }} staff={{ id: 's1', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 0, duration_minutes: 60 }} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm cancelDeadlineMinutesBefore={90} onBack={() => {}} onSubmitted={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: /相談したい内容/ }), { target: { value: '予約の相談' } });
  expect(screen.getByText(/キャンセルは開始の90分前まで/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /この内容で予約/ }));
  await vi.waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ menu_id: 'm1', customer_note: '予約の相談' }), expect.any(String)));
});
