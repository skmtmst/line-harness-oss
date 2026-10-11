import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getLastLoginByStaff } from '../src/login-audit.js';
import { getStaffAccountScopeMap } from '../src/staff.js';
import { countRepliesForRequests } from '../src/ops-support.js';
import { asD1 } from './d1-test-helper.js';

test.each(['login', 'staff', 'support'] as const)('SCALE-03 仲間: %s の201件を取得できる', async (kind) => {
  const raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  try {
    const db = asD1(raw);
    const ids = Array.from({ length: 201 }, (_, i) => `synthetic-${i}`);
    const call = kind === 'login' ? getLastLoginByStaff(db, ids)
      : kind === 'staff' ? getStaffAccountScopeMap(db, ids) : countRepliesForRequests(db, ids);
    expect(await call).toEqual(kind === 'login' ? {} : new Map());
  } finally { raw.close(); }
});
