// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type BookingCancellationPreview, type MenuItem, type StaffItem } from '../lib/api.js';
import { initialParty, resize, type PartyState } from '../lib/party.js';
import { PartyStaffStep, PartySummary } from './party-step.js';
import Confirm from './confirm.js';

vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => 'qa-liff', getIdToken: () => 'fake-token' }));
const menu: MenuItem = { id: 'menu', name: '見本の施術', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 8400, sort_order: 0, max_party_size: 3 };
const staff: StaffItem = { id: 'staff', display_name: '見本の担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, nomination_fee: 1000, price: 9000, duration_minutes: 75 };
const preview: BookingCancellationPreview = { enabled: false, version: 0, freeUntil: null, afterPercent: 50, noShowPercent: 100, price: 9000, deposit: null };
const primary = () => screen.getByRole('button', { name: /この内容で予約/ }) as HTMLButtonElement;
const withStaff = (designated: boolean) => ({ ...initialParty().members[0], staff, designated });

beforeEach(() => {
  vi.spyOn(api, 'cancellationPreview').mockResolvedValue(preview);
  vi.spyOn(api, 'entitlements').mockResolvedValue([]);
  vi.spyOn(api, 'createRequest').mockResolvedValue({ booking_id: 'booking', status: 'requested' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method && init.method !== 'GET') throw new Error('unexpected write');
    if (url.pathname !== '/api/liff/booking/menus/menu/staff') throw new Error('unexpected read');
    return new Response(JSON.stringify({ staff: [staff], success: true }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('実APIで読んだ仮担当は非指名のまま、明示した人だけに指名料を加算する', async () => {
  let latest = resize(initialParty(), 2);
  function Subject() {
    const [party, setParty] = useState(latest); latest = party;
    return <><PartyStaffStep menu={menu} party={party} onParty={setParty} /><PartySummary party={party} first={menu} withFee /></>;
  }
  const view = render(<Subject />);
  await waitFor(() => expect(latest.members.every(member => member.staff?.id === staff.id)).toBe(true));
  const summary = () => view.container.querySelector('[data-party-summary]')!;
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(latest.members.every(member => !member.designated)).toBe(true);
  expect(summary().textContent).toContain('2 人・同時に 75 分・¥18,000');
  expect(summary().textContent).not.toContain('指名料');
  expect(summary().textContent?.match(/指名なし/g)).toHaveLength(2);
  fireEvent.click(within(screen.getByRole('group', { name: '1 人目（あなた）の担当' })).getByRole('button', { name: /見本の担当/ }));
  expect(summary().textContent).toContain('2 人・同時に 75 分・¥19,000');
  expect(summary().textContent?.match(/指名料/g)).toHaveLength(1);
  fireEvent.click(within(screen.getByRole('group', { name: '2 人目（お連れさま）の担当' })).getByRole('button', { name: /見本の担当/ }));
  expect(summary().textContent).toContain('2 人・続けて 150 分・¥20,000');
  expect(summary().textContent?.match(/指名料/g)).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(summary().textContent).not.toContain('指名料');
  expect(latest.members.every(member => member.staff === null && !member.designated)).toBe(true);
  expect(api.createRequest).not.toHaveBeenCalled();
});

it('指名料0の内訳でも仮の担当名を指名した名前として表示しない', () => {
  const party = resize(initialParty(), 2);
  party.members = [withStaff(false), { ...withStaff(true), staff: { ...staff, nomination_fee: 0 } }];
  const view = render(<PartySummary party={party} first={menu} withFee />);
  const rows = view.container.querySelector('[data-party-summary]')!.children;
  expect(rows[0].textContent).toContain('・指名なし');
  expect(rows[0].textContent).not.toContain(staff.display_name);
  expect(rows[1].textContent).toContain(`・${staff.display_name}`);
});

it.each([[false, false, '¥18,000'], [true, false, '¥19,000'], [true, true, '¥20,000']] as const)('確認も同じ人ごとの指名 %s/%s と料金を表示し、複数人は送らない', async (first, second, price) => {
  const party: PartyState = { size: 2, members: [withStaff(first), withStaff(second)] };
  const view = render(<Confirm menu={menu} staff={staff} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm={false} party={party} onSubmitted={vi.fn()} />);
  await waitFor(() => expect(primary().disabled).toBe(false));
  const rows = [...view.container.querySelectorAll('dl dd')];
  expect(rows[0].textContent).toBe(`見本の施術・${first ? staff.display_name : '指名なし'}`);
  expect(rows[1].textContent).toBe(`見本の施術・${second ? staff.display_name : '指名なし'}`);
  expect(screen.getByText(`${price}（目安）`)).toBeTruthy();
  expect(screen.getByText(first && second ? /10:00〜12:30/ : /10:00〜11:15/)).toBeTruthy();
  fireEvent.click(primary());
  await screen.findByText('現在準備中です');
  expect(api.createRequest).not.toHaveBeenCalled();
});

it('明示指名の既存担当名fallbackを維持する', async () => {
  const party: PartyState = { size: 2, members: [{ ...withStaff(true), staff: null }, withStaff(false)] };
  const view = render(<Confirm menu={menu} staff={staff} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm={false} party={party} onSubmitted={vi.fn()} />);
  await waitFor(() => expect(primary().disabled).toBe(false));
  expect(view.container.querySelector('dl dd')?.textContent).toBe(`見本の施術・${staff.display_name}`);
});

it('通常1人と追加メニューの明示指名は既存の価格と予約payloadを保つ', async () => {
  const addon = { id: 'addon', name: '追加', price: 300, duration_minutes: 15 };
  const party: PartyState = { size: 1, members: [{ ...withStaff(true), addonIds: [addon.id] }] };
  render(<Confirm menu={{ ...menu, addons: [addon] }} staff={staff} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm={false} party={party} onSubmitted={vi.fn()} />);
  await waitFor(() => expect(primary().disabled).toBe(false));
  expect(screen.getByText('¥10,300（目安）')).toBeTruthy();
  expect(screen.getByText(/10:00〜11:30/)).toBeTruthy();
  fireEvent.click(primary());
  await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
  expect(api.createRequest).toHaveBeenCalledWith({ menu_id: 'menu', staff_id: 'staff', starts_at: '2099-01-01T01:00:00.000Z', customer_note: undefined, addonIds: ['addon'] }, expect.any(String));
});
