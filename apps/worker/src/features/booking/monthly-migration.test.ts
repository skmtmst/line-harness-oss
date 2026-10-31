import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const before = execFileSync('git', ['show', 'e35954f820:packages/db/bootstrap.sql'], { cwd: root, encoding: 'utf8', maxBuffer: 8_000_000 });
const migration = readFileSync(new URL('../../../../../packages/db/migrations/749_booking_monthly_ledger.sql', import.meta.url), 'utf8');
it('748までの実DBに749を適用し、旧の行・使用トリガー・外部キーを保つ', () => {
  const db = new Database(':memory:');
  try {
    db.exec(before);
    db.pragma('foreign_keys=ON');
    db.exec(`INSERT INTO tenants(id,name) VALUES('t','店');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','ch','店','test','test','t');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
      INSERT INTO booking_entitlements(id,line_account_id,friend_id,kind,name,monthly_limit,valid_from,expires_at,source,billing_status,grace_until,created_at,updated_at)
      VALUES('legacy','a','f','monthly','旧の月謝',4,'2026-10-01T00:00:00Z','2026-12-01T00:00:00Z','online','grace','2026-10-02T00:00:00Z','2026-10-01','2026-10-01');`);
    const legacy = db.prepare('SELECT * FROM booking_entitlements').all();
    db.exec(migration);
    expect(db.prepare('SELECT * FROM booking_entitlements').all()).toEqual(legacy);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN('pass_plan_selection','event_entitlement_selection','booking_pass_grace_selection')").all()).toHaveLength(3);
    expect(db.prepare("SELECT count(*) n FROM booking_monthly_contracts").get()).toEqual({ n: 0 });
  } finally { db.close(); }
});
