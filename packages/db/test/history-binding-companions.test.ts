import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getLastLoginByStaff } from '../src/login-audit.js';
import { getStaffNameMap, getStaffAccountScopeMap } from '../src/staff.js';
import { countRepliesForRequests } from '../src/ops-support.js';
import { getRemindersByIds } from '../src/reminders/index.js';
import { getAccountSettings } from '../src/account-settings.js';
import { asD1 } from './d1-test-helper.js';

test.each(['login', 'staff', 'support', 'staff-names', 'reminders', 'settings'] as const)('SCALE-03 仲間: %s の201件を取得できる', async (kind) => {
  const raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  try {
    const db = asD1(raw);
    const ids = Array.from({ length: 201 }, (_, i) => `synthetic-${i}`);
    const call = kind === 'login' ? getLastLoginByStaff(db, ids)
      : kind === 'staff' ? getStaffAccountScopeMap(db, ids)
      : kind === 'staff-names' ? getStaffNameMap(db, ids)
      : kind === 'reminders' ? getRemindersByIds(db, ids)
      : kind === 'settings' ? getAccountSettings(db, 'synthetic', ids)
      : countRepliesForRequests(db, ids);
    expect(await call).toEqual(kind === 'login' || kind === 'settings' ? {} : kind === 'reminders' ? [] : new Map());
  } finally { raw.close(); }
});
