import { formatYen as yen } from '@line-crm/shared';
import type { MenuAddon, MenuItem, StaffItem } from './api.js';

/*
 * 同伴・複数メニュー（B5）の組み立て。1 予約＝1 人のまま、組（group）に人を足す。
 * 人数の上限はメニューの max_party_size（既定 1＝今までどおり）。追加メニューは人ごとに 3 つまで。
 */
export const MAX_ADDONS = 3;

export type PartyMember = {
  /** null＝1 人目と同じメニュー。 */
  menu: MenuItem | null;
  addonIds: string[];
  /** null＝指名なし。 */
  staff: StaffItem | null;
  /** 指名なしを選び直したときに、担当の選び直しを求めないための印。 */
  designated: boolean;
};

export type PartyState = { size: number; members: PartyMember[] };

export const emptyMember = (): PartyMember => ({ menu: null, addonIds: [], staff: null, designated: false });
export const initialParty = (): PartyState => ({ size: 1, members: [emptyMember()] });

export const partyCapable = (menu: MenuItem | null): boolean => Boolean(menu && ((menu.max_party_size ?? 1) > 1 || (menu.addons?.length ?? 0) > 0));

export function resize(party: PartyState, size: number): PartyState {
  const members = Array.from({ length: size }, (_, i) => party.members[i] ?? emptyMember());
  return { size, members };
}

export const menuOf = (party: PartyState, first: MenuItem, index: number): MenuItem => party.members[index]?.menu ?? first;
export const addonsOf = (menu: MenuItem, member: PartyMember): MenuAddon[] => (menu.addons ?? []).filter((a) => member.addonIds.includes(a.id));

export function memberMinutes(menu: MenuItem, member: PartyMember): number {
  return menu.duration_minutes + addonsOf(menu, member).reduce((n, a) => n + a.duration_minutes, 0);
}
export function memberPrice(menu: MenuItem, member: PartyMember): number {
  return menu.base_price + addonsOf(menu, member).reduce((n, a) => n + a.price, 0);
}
/** 指名料＝担当の料金とメニューの料金の差。指名なし・差が無いときは 0。 */
export function designationFee(menu: MenuItem, member: PartyMember): number {
  return member.staff && !member.staff.is_designation_optional ? Math.max(0, member.staff.price - menu.base_price) : 0;
}

export function totals(party: PartyState, first: MenuItem) {
  const rows = party.members.map((member, index) => {
    const menu = menuOf(party, first, index);
    return { index, menu, member, minutes: memberMinutes(menu, member), price: memberPrice(menu, member), fee: designationFee(menu, member) };
  });
  /* 同時に始める：いちばん長い人の時間。同じ担当で続けるときは足し算（担当の画面で選ぶ）。 */
  const sequential = sameStaffSequence(party);
  const minutes = sequential ? rows.reduce((n, r) => n + r.minutes, 0) : Math.max(...rows.map((r) => r.minutes));
  return { rows, minutes, price: rows.reduce((n, r) => n + r.price + r.fee, 0), sequential };
}

/** 全員が同じ担当を指名したら続けて受ける（時間が直列になる）。 */
export function sameStaffSequence(party: PartyState): boolean {
  const ids = party.members.map((m) => m.staff?.id ?? null);
  return party.size > 1 && ids.every((id) => id !== null && id === ids[0]);
}

export const personLabel = (index: number): string => (index === 0 ? '1 人目（あなた）' : `${index + 1} 人目（お連れさま）`);
export const personShort = (index: number): string => `${index + 1} 人目`;
export { yen };
export function menuLine(menu: MenuItem, member: PartyMember): string {
  const extra = addonsOf(menu, member).map((a) => a.name);
  return extra.length ? `${menu.name}＋${extra.join('＋')}` : menu.name;
}
