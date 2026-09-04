import { describe, expect, it } from 'vitest';
import {
  POLICY_CUTOFF_PREFIX,
  checkMigration,
  filterMigrationsByPolicy,
} from './check-migrations';

describe('checkMigration', () => {
  it('allows CREATE TABLE', () => {
    const sql = `CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with NULL (no NOT NULL)', () => {
    const sql = `ALTER TABLE foo ADD COLUMN nickname TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows CREATE INDEX', () => {
    const sql = `CREATE INDEX idx_foo_name ON foo (name);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows INSERT seed data', () => {
    const sql = `INSERT INTO foo (id, name) VALUES (1, 'seed');`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks DROP TABLE', () => {
    const sql = `DROP TABLE foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP TABLE/i);
  });

  it('blocks DROP COLUMN', () => {
    const sql = `ALTER TABLE foo DROP COLUMN name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP COLUMN/i);
  });

  it('blocks RENAME TABLE (ALTER TABLE x RENAME TO y)', () => {
    const sql = `ALTER TABLE foo RENAME TO bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME/i);
  });

  it('blocks RENAME COLUMN', () => {
    const sql = `ALTER TABLE foo RENAME COLUMN old_name TO new_name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME COLUMN/i);
  });

  it('blocks ALTER COLUMN TYPE', () => {
    const sql = `ALTER TABLE foo ALTER COLUMN id TYPE INTEGER;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/ALTER COLUMN TYPE/i);
  });

  it('blocks NOT NULL without default', () => {
    const sql = `ALTER TABLE foo ADD COLUMN required_field TEXT NOT NULL;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/NOT NULL/i);
  });

  it('allows NOT NULL with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks ADD UNIQUE constraint (inline)', () => {
    const sql = `ALTER TABLE foo ADD UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('blocks ADD CONSTRAINT UNIQUE', () => {
    const sql = `ALTER TABLE foo ADD CONSTRAINT foo_email_unique UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('ignores -- line comments (DROP TABLE in comment is OK)', () => {
    const sql = `-- DROP TABLE foo;\nCREATE TABLE bar (id INTEGER);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('ignores comments mentioning forbidden constructs', () => {
    const sql = `-- This adds a column. We must NOT NULL would be bad without default.\nALTER TABLE foo ADD COLUMN x TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('returns first violation if multiple', () => {
    const sql = `DROP TABLE foo;\nDROP TABLE bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });

  it('allows CREATE UNIQUE INDEX (this is index, not ADD UNIQUE constraint)', () => {
    const sql = `CREATE UNIQUE INDEX idx_foo_email ON foo (email);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('handles case-insensitive matching', () => {
    const sql = `drop table foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });
});

describe('filterMigrationsByPolicy', () => {
  const sample = [
    '001_round2.sql',
    '40_not_zero_padded.sql',
    '027_dedup_delivery.sql',
    '029_account_management_v2.sql',
    '040_events_multi_account.sql',
    '041_update_history.sql',
    '042_future.sql',
    '1000_four_digit_future.sql',
  ];

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX by default', () => {
    expect(POLICY_CUTOFF_PREFIX).toBe('041');
    expect(filterMigrationsByPolicy(sample)).toEqual([
      '041_update_history.sql',
      '042_future.sql',
      '1000_four_digit_future.sql',
    ]);
  });

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX when all is false', () => {
    expect(filterMigrationsByPolicy(sample, { all: false })).toEqual([
      '041_update_history.sql',
      '042_future.sql',
      '1000_four_digit_future.sql',
    ]);
  });

  it('returns all files when all flag is true', () => {
    expect(filterMigrationsByPolicy(sample, { all: true })).toEqual(sample);
  });

  it('excludes the pre-existing 027 / 029 violations under the default cutoff', () => {
    const filtered = filterMigrationsByPolicy(sample);
    expect(filtered).not.toContain('027_dedup_delivery.sql');
    expect(filtered).not.toContain('029_account_management_v2.sql');
  });

  it('compares prefixes as numbers and keeps four-digit migrations in policy', () => {
    expect(filterMigrationsByPolicy([
      '40_old.sql',
      '041_current.sql',
      '1000_future.sql',
      'draft_without_number.sql',
    ])).toEqual([
      '041_current.sql',
      '1000_future.sql',
      'draft_without_number.sql',
    ]);
  });

  it('returns an empty array when no files meet the cutoff', () => {
    expect(filterMigrationsByPolicy(['001_a.sql', '010_b.sql'])).toEqual([]);
  });
});

/*
 * 表の作り直し。
 *
 * SQLite は CHECK を後から変えられないので、
 *   新しい表を作る → 中身を写す → 古い表を落とす → 名前を付け替える
 * しか手が無い。この途中に DROP TABLE と RENAME TO が必ず入るので、
 * additive-only の規則と真正面からぶつかる。
 *
 * 禁止を外すと、うっかりの DROP TABLE まで通る。**印を書いた場合だけ**
 * 通し、しかも印を書けば何でも落とせる、にはしない。
 */
describe('表の作り直し', () => {
  const REBUILD = `-- migration-policy: table-rebuild
DROP TABLE broadcasts;
ALTER TABLE broadcasts_new RENAME TO broadcasts;`;

  it('印があって、形が合っていれば通す', () => {
    expect(checkMigration(REBUILD).ok).toBe(true);
  });

  it('_next 接尾辞の作り直しも、印があれば通す', () => {
    const sql = `-- migration-policy: table-rebuild
CREATE TABLE broadcasts_next (id TEXT PRIMARY KEY);
DROP TABLE broadcasts;
ALTER TABLE broadcasts_next RENAME TO broadcasts;`;
    expect(checkMigration(sql).ok).toBe(true);
  });

  it('_next 接尾辞でも印が無ければ止める', () => {
    const sql = `CREATE TABLE broadcasts_next (id TEXT PRIMARY KEY);
DROP TABLE broadcasts;
ALTER TABLE broadcasts_next RENAME TO broadcasts;`;
    expect(checkMigration(sql).ok).toBe(false);
  });

  it('印が無ければ、これまでどおり止める', () => {
    const without = REBUILD.split('\n').slice(1).join('\n');
    const result = checkMigration(without);
    expect(result.ok).toBe(false);
  });

  it('印を書いても、落とすだけなら通さない', () => {
    // 印さえ書けば何でも落とせる、では印の意味が無い。
    const result = checkMigration(`-- migration-policy: table-rebuild
DROP TABLE broadcasts;`);
    expect(result.ok).toBe(false);
  });

  it('印を書いても、別の表へ改名するなら通さない', () => {
    const result = checkMigration(`-- migration-policy: table-rebuild
DROP TABLE broadcasts;
ALTER TABLE something_else RENAME TO broadcasts;`);
    expect(result.ok).toBe(false);
  });

  it('印だけ書いて何もしないのは通さない', () => {
    expect(checkMigration('-- migration-policy: table-rebuild').ok).toBe(false);
  });

  it('印があっても、作り直しと関係ない禁止事項は止める', () => {
    // 作り直しのファイルに、ついでに危ないことを混ぜられないように。
    const result = checkMigration(`-- migration-policy: table-rebuild
DROP TABLE broadcasts;
ALTER TABLE broadcasts_new RENAME TO broadcasts;
ALTER TABLE friends DROP COLUMN metadata;`);
    expect(result.ok).toBe(false);
  });
});

describe('印が付く前に当ててしまった作り直し', () => {
  it('名前で通す（適用済みは書き換えない決まりのため）', () => {
    const sql = 'DROP TABLE scenario_steps;';
    expect(checkMigration(sql).ok).toBe(false);
    expect(checkMigration(sql, '134_step_message_kinds_swap.sql').ok).toBe(true);
  });

  it('一覧に無いファイル名では通さない', () => {
    expect(checkMigration('DROP TABLE friends;', '999_whatever.sql').ok).toBe(false);
  });

  it('grandfathers the four rebuilds that were applied before the marker existed', () => {
    for (const name of [
      '189_analytics_cross.sql',
      '192_inbox_v6_foundation.sql',
      '202_ec_event_account_and_identity.sql',
      '265_nen_shared_friend_add_coupon.sql',
    ]) {
      expect(checkMigration('DROP TABLE x;', name).ok).toBe(true);
    }
  });
});
