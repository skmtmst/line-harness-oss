// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivacyNote, { MUSUBO_PRIVACY_URL, privacyPolicyUrl } from './privacy-note.js';
import Confirm from '../confirm.js';
import EventConfirm from '../../pages/event-confirm.js';
import Form from '../../pages/form.js';
import SeatConfirm from '../../pages/seat/seat-confirm.js';

vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../../lib/api.js', () => ({ api: {
  liffConfig: vi.fn().mockResolvedValue({ data: {} }),
  customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
  cancellationPreview: vi.fn().mockResolvedValue({ enabled: false }), entitlements: vi.fn().mockResolvedValue([]),
  getEvent: vi.fn().mockResolvedValue({ id: 'event', name: '交流会', questions: [] }),
  getEventSlots: vi.fn().mockResolvedValue({ items: [{ id: 'slot', starts_at: '2099-01-01T01:00:00Z', ends_at: '2099-01-01T02:00:00Z' }] }),
  getForm: vi.fn().mockResolvedValue({ id: 'form', name: '受付', isActive: true, layout: { version: 2, header: [], sections: [{ id: 'section', blocks: [] }], options: {} } }),
} }));
afterEach(cleanup);

function policyLink() { return screen.getByRole('link', { name: 'プライバシーポリシー' }); }
describe('プライバシーポリシーの一行', () => {
  it('基本はmusubo、安全なお店のURLがあれば優先する', () => {
    expect(privacyPolicyUrl()).toBe(MUSUBO_PRIVACY_URL);
    expect(privacyPolicyUrl('javascript:alert(1)')).toBe(MUSUBO_PRIVACY_URL);
    const view = render(<PrivacyNote />);
    expect(policyLink().getAttribute('href')).toBe(MUSUBO_PRIVACY_URL);
    expect(policyLink().getAttribute('target')).toBe('_blank');
    expect(policyLink().getAttribute('rel')).toBe('noreferrer');
    view.rerender(<PrivacyNote shopPrivacyUrl="https://shop.example/privacy" />);
    expect(policyLink().getAttribute('href')).toBe('https://shop.example/privacy');
  });

  it('予約の送信前に表示する', async () => {
    render(<Confirm menu={{ id: 'menu', name: '相談', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 1000, sort_order: 0 }} staff={{ id: 'staff', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 1000, duration_minutes: 60 }} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm onSubmitted={() => {}} />);
    expect(await screen.findByRole('link', { name: 'プライバシーポリシー' })).toBeTruthy();
  });
  it('イベント申込の送信前に表示する', async () => {
    render(<MemoryRouter initialEntries={['/events/event/confirm?slotId=slot']}><Routes><Route path="/events/:id/confirm" element={<EventConfirm />} /></Routes></MemoryRouter>);
    await screen.findByRole('button', { name: '申し込む' });
    expect(policyLink().getAttribute('href')).toBe(MUSUBO_PRIVACY_URL);
  });
  it('フォームの送信前に表示する', async () => {
    render(<MemoryRouter initialEntries={['/forms/form']}><Routes><Route path="/forms/:id" element={<Form />} /></Routes></MemoryRouter>);
    await screen.findByRole('button', { name: '送信する' });
    expect(policyLink().getAttribute('href')).toBe(MUSUBO_PRIVACY_URL);
  });
  it('席の予約の確定前に表示する', () => {
    render(<SeatConfirm timeZone="Asia/Tokyo" storeName="お店" customerName="利用者" startsAt="2099-01-01T01:00:00Z" endsAt="2099-01-01T02:00:00Z" guestCount={2} cancelDeadlineMinutesBefore={60} seat="テーブル席" late="LINEで連絡" note="" phone="" onNote={() => {}} onPhone={() => {}} holdExpiresAt={null} holdMinutes={10} reschedule={false} error={null} onBack={() => {}} onExpired={() => {}} />);
    expect(policyLink().getAttribute('href')).toBe(MUSUBO_PRIVACY_URL);
  });
});
