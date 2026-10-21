import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteFormAtRevision } from '../src/forms/definitions.js';
import { deleteUnusedConversionDefinition } from '../src/conversion-definitions/revisions-lifecycle.js';
import { deleteReminderStep } from '../src/reminders/versions-steps.js';

// D1 reports sqlite3_total_changes(), including foreign-key cascades and triggers.
function asD1WithCascades(sqlite: Database.Database): D1Database {
  const total = () => (sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  function prepare(sql: string, params: unknown[] = []): D1PreparedStatement {
    const run = () => {
      const before = total();
      sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: total() - before } };
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...params) ?? null,
      all: async () => ({ success: true, results: sqlite.prepare(sql).all(...params), meta: {} }),
      run: async () => run(),
      runSyncForBatch: run,
    } as unknown as D1PreparedStatement;
  }
  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => sqlite.transaction(() => statements.map(
      (statement) => (statement as unknown as { runSyncForBatch: () => unknown }).runSyncForBatch(),
    ))(),
  } as unknown as D1Database;
}

describe('deletion results with D1 cascade counts', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO line_accounts
      (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
      VALUES ('account-1', 'channel-1', 'QA', 'secret', 'token', '2026-10-21', '2026-10-21')`);
    db = asD1WithCascades(sqlite);
  });
  afterEach(() => sqlite.close());

  it('reports deletion of an unpublished form with its account binding', async () => {
    sqlite.exec(`INSERT INTO forms (id, name, fields, is_active) VALUES ('form-1', 'QA', '[]', 0);
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'account-1')`);
    const { revision } = sqlite.prepare("SELECT revision FROM forms WHERE id = 'form-1'").get() as { revision: number };
    expect(await deleteFormAtRevision(db, 'form-1', revision + 1)).toBe(false);
    expect(await deleteFormAtRevision(db, 'form-1', revision)).toBe(true);
    expect(sqlite.prepare('SELECT * FROM form_accounts').all()).toHaveLength(0);
    expect(await deleteFormAtRevision(db, 'form-1', revision)).toBe(false);
  });

  it('reports deletion of an unused conversion definition and retains its deletion audit', async () => {
    sqlite.exec(`INSERT INTO conversion_points (id, name, event_type, line_account_id, version)
      VALUES ('point-1', 'QA', 'purchase', 'account-1', 2);
      INSERT INTO conversion_definition_revisions
      (id, conversion_point_id, from_version, to_version, before_config_json, after_config_json,
       performed_by, created_at) VALUES ('revision-1', 'point-1', 1, 2, '{}', '{}', 'qa', '2026-10-21')`);
    const input = { id: 'point-1', scope: { allowedAccountIds: ['account-1'], includeUnassigned: false },
      expectedVersion: 2, staffId: 'qa' };
    await expect(deleteUnusedConversionDefinition(db, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(deleteUnusedConversionDefinition(db, input)).resolves.toEqual({ id: 'point-1', deleted: true });
    expect(sqlite.prepare('SELECT * FROM conversion_definition_revisions').all()).toHaveLength(0);
    expect(sqlite.prepare("SELECT action FROM conversion_definition_operations WHERE conversion_point_id = 'point-1'").get()).toEqual({ action: 'delete' });
  });

  it('reports deletion of a reminder step with legacy delivery children', async () => {
    sqlite.exec(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('friend-1', 'line-qa', 'account-1');
      INSERT INTO reminders (id, name, line_account_id) VALUES ('reminder-1', 'QA', 'account-1');
      INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
      VALUES ('step-1', 'reminder-1', 0, 'text', 'QA');
      INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date)
      VALUES ('enrollment-1', 'friend-1', 'reminder-1', '2026-10-21');
      INSERT INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id)
      VALUES ('delivery-1', 'enrollment-1', 'step-1')`);
    expect(await deleteReminderStep(db, 'other-reminder', 'step-1')).toBe(false);
    expect(await deleteReminderStep(db, 'reminder-1', 'step-1')).toBe(true);
    expect(sqlite.prepare('SELECT * FROM friend_reminder_deliveries').all()).toHaveLength(0);
    expect(sqlite.prepare('SELECT * FROM friend_reminders').all()).toHaveLength(1);
    expect(await deleteReminderStep(db, 'reminder-1', 'step-1')).toBe(false);
  });
});
