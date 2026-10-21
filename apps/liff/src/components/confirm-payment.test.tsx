// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Confirm from './confirm.js';
import { api, type BookingCancellationPreview } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { cancellationPreview: vi.fn(), entitlements: vi.fn(), createRequest: vi.fn() } }));
const menu = { id: 'm', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 8400, sort_order: 0, payment_mode: 'customer_choice' as const };
const staff = { id: 's', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 8400, duration_minutes: 60 };
const slot = { date: '2099-01-01', start: '10:00' };
const preview = (allowedMethods: Array<'online' | 'onsite'> = ['online', 'onsite']): BookingCancellationPreview => ({
  enabled: false, version: 0, freeUntil: null, afterPercent: 50, noShowPercent: 100, price: 8400, deposit: null,
  payment: { mode: 'customer_choice', allowedMethods },
});
const primary = () => screen.getByRole('button', { name: /この内容で予約/ }) as HTMLButtonElement;
beforeEach(() => {
  vi.mocked(api.cancellationPreview).mockReset().mockResolvedValue(preview());
  vi.mocked(api.entitlements).mockReset().mockResolvedValue([]);
  vi.mocked(api.createRequest).mockReset().mockResolvedValue({ booking_id: 'b', status: 'requested' });
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('external_network_forbidden'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['online', 'onsite'] as const)('未選択では送らず、本人の%s選択を既存の作成口へ送る', async method => {
  const onSubmitted = vi.fn(), onPaymentChange = vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm onSubmitted={onSubmitted} onPaymentChange={onPaymentChange} />);
  const online = await screen.findByRole('radio', { name: 'オンラインで先に払う' });
  expect(primary().disabled).toBe(true); fireEvent.click(primary()); expect(api.createRequest).not.toHaveBeenCalled();
  fireEvent.click(method === 'online' ? online : screen.getByRole('radio', { name: 'お店で払う' }));
  expect(primary().disabled).toBe(false);
  expect(primary().textContent).toContain(method === 'online' ? 'リクエスト' : '確定');
  expect(onPaymentChange).toHaveBeenLastCalledWith(method === 'online');
  if (method === 'online') expect(screen.queryByText(/目安・当日払う/)).toBeNull();
  fireEvent.click(primary());
  await waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ payment_method: method, menu_id: 'm', staff_id: 's' }), expect.any(String)));
  expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b', status: 'requested' }));
});

it('先払いだけの選択肢では店頭払いも制限理由も出さず、本人の選択を待つ', async () => {
  vi.mocked(api.cancellationPreview).mockResolvedValue(preview(['online']));
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={() => {}} />);
  await screen.findByRole('radio', { name: 'オンラインで先に払う' });
  expect(screen.queryByRole('radio', { name: 'お店で払う' })).toBeNull();
  expect(screen.queryByText(/無断|前払いのみ/)).toBeNull(); expect(primary().disabled).toBe(true);
});

it('古い応答で選択条件が欠けていたら送らず、再読込後だけ選べる', async () => {
  const old = preview(); delete old.payment;
  vi.mocked(api.cancellationPreview).mockResolvedValueOnce(old).mockResolvedValueOnce(preview());
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={() => {}} />);
  await screen.findByText(/お支払い方法を読み込めませんでした/);
  expect(primary().disabled).toBe(true); expect(api.createRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
  await screen.findByRole('radio', { name: 'お店で払う' }); expect(primary().disabled).toBe(true);
});

it('送信失敗でも選択と要望を保ち、明示再送は同じ予約キーを使う', async () => {
  vi.mocked(api.createRequest).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ booking_id: 'b', status: 'confirmed' });
  const onSubmitted = vi.fn();
  render(<Confirm menu={{ ...menu, intake_question: 'ご要望' }} staff={staff} slot={slot} autoConfirm={false} onSubmitted={onSubmitted} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'お店で払う' }));
  fireEvent.change(screen.getByRole('textbox', { name: /ご要望/ }), { target: { value: '髪を短く' } });
  fireEvent.click(primary()); await screen.findByRole('alert');
  expect((screen.getByRole('radio', { name: 'お店で払う' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('textbox', { name: /ご要望/ }) as HTMLTextAreaElement).value).toBe('髪を短く');
  fireEvent.click(primary()); await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.createRequest).mock.calls[0][1]).toBe(vi.mocked(api.createRequest).mock.calls[1][1]);
});

it('回数券を選ぶと方法を送らず、券を外すと元の本人選択へ戻る', async () => {
  vi.mocked(api.entitlements).mockResolvedValue([{ id: 'ticket', name: '5回券', kind: 'ticket', usable: true, remaining: 5 }] as never);
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={() => {}} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'オンラインで先に払う' }));
  fireEvent.click(await screen.findByRole('button', { name: /5回券/ }));
  expect(screen.queryByRole('group', { name: 'お支払い方法' })).toBeNull(); expect(primary().disabled).toBe(false);
  fireEvent.click(primary());
  await waitFor(() => expect(api.createRequest).toHaveBeenCalled());
  expect(vi.mocked(api.createRequest).mock.calls[0][0]).toMatchObject({ entitlement_id: 'ticket' });
  expect(vi.mocked(api.createRequest).mock.calls[0][0]).not.toHaveProperty('payment_method');
  await waitFor(() => expect(primary().disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: '使わない' }));
  expect((screen.getByRole('radio', { name: 'オンラインで先に払う' }) as HTMLInputElement).checked).toBe(true);
});

it('対象メニューと日時が変われば前の支払選択を使わない', async () => {
  const view = render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={() => {}} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'お店で払う' })); expect(primary().disabled).toBe(false);
  view.rerender(<Confirm menu={{ ...menu, id: 'other' }} staff={staff} slot={{ ...slot, start: '11:00' }} autoConfirm={false} onSubmitted={() => {}} />);
  await screen.findByRole('radio', { name: 'お店で払う' }); expect(primary().disabled).toBe(true);
  expect((screen.getByRole('radio', { name: 'お店で払う' }) as HTMLInputElement).checked).toBe(false);
});

it('確定直前に選択条件が変わったら再読込し、古い店頭選択では再送しない', async () => {
  vi.mocked(api.createRequest).mockRejectedValueOnce({ status: 400, code: 'payment_method_not_allowed', body: { error: '入力内容を確認してください', code: 'payment_method_not_allowed' } });
  vi.mocked(api.cancellationPreview).mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview(['online']));
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm={false} onSubmitted={() => {}} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'お店で払う' })); fireEvent.click(primary());
  await screen.findByText(/お支払い方法が変わりました/);
  await screen.findByRole('radio', { name: 'オンラインで先に払う' });
  expect(screen.queryByRole('radio', { name: 'お店で払う' })).toBeNull(); expect(primary().disabled).toBe(true);
});

it('選んだオンラインが無料なら余分な支払いの手順を増やさない', async () => {
  const onPaymentChange = vi.fn(), onSubmitted = vi.fn();
  vi.mocked(api.createRequest).mockResolvedValueOnce({ booking_id: 'b', status: 'confirmed', prepayNotice: '無断キャンセルが続いているため、この予約は前払いのみです。' });
  render(<Confirm menu={{ ...menu, base_price: 0 }} staff={{ ...staff, price: 0 }} slot={slot} autoConfirm onSubmitted={onSubmitted} onPaymentChange={onPaymentChange} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'オンラインで先に払う' }));
  expect(onPaymentChange).toHaveBeenLastCalledWith(false); expect(primary().textContent).toContain('確定');
  fireEvent.click(primary());
  await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ prepayNotice: null })));
});
