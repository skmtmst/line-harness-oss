import { expect, it } from 'vitest';
import type { StaffMember } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { readAuthenticatedStaffRecord, rememberAuthenticatedStaffRecord } from './authenticated-staff-record.js';

function identity(): AuthenticatedStaff { return { id: 'actor', name: 'Fixture', role: 'owner', readOnly: false }; }
const member = { id: 'actor', is_active: 1, account_scope: 'accounts' } as StaffMember;

it('同じ認証オブジェクトとDBの中でだけ本人行を共有する', () => {
  const db = {} as D1Database;
  const staff = identity();
  rememberAuthenticatedStaffRecord(db, staff, member);
  expect(readAuthenticatedStaffRecord(db, staff)).toBe(member);
  expect(readAuthenticatedStaffRecord({} as D1Database, staff)).toBeUndefined();
  expect(readAuthenticatedStaffRecord(db, identity())).toBeUndefined();
  expect(readAuthenticatedStaffRecord(db, { ...staff })).toBeUndefined();
});

it('担当範囲のない部分行は使い回さず、呼ぶ側の再取得へ戻す', () => {
  const db = {} as D1Database;
  const staff = identity();
  rememberAuthenticatedStaffRecord(db, staff, { id: 'actor', is_active: 1 } as StaffMember);
  expect(readAuthenticatedStaffRecord(db, staff)).toBeUndefined();
});

it('本人IDが変わったときは保存済みの行を返さない', () => {
  const db = {} as D1Database;
  const staff = identity();
  rememberAuthenticatedStaffRecord(db, staff, member);
  staff.id = 'other';
  expect(readAuthenticatedStaffRecord(db, staff)).toBeUndefined();
});
