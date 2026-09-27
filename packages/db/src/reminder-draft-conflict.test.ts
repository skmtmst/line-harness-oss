import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getReminderById,
  saveReminderDraftVersion,
  updateReminder,
} from './reminders.js';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

const OLD_STAMP = '2026-09-27T10:00:00.000+09:00';

function setup(): { sqlite: Database.Database; db: D1Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE reminders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      trigger_type TEXT,
      trigger_offset_minutes INTEGER,
      send_at_time TEXT,
      target_tag_id TEXT,
      line_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivery_mode TEXT,
      trigger_field_id TEXT,
      trigger_event_id TEXT,
      repeat_yearly INTEGER,
      leap_year_policy TEXT,
      folder_id TEXT,
      display_order INTEGER,
      deleted_at TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'draft',
      current_draft_version_id TEXT,
      current_published_version_id TEXT
    );
    CREATE TABLE reminder_versions (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'superseded')),
      settings_snapshot TEXT NOT NULL,
      last_test_status TEXT,
      last_tested_at TEXT,
      last_tested_by_staff_id TEXT,
      published_at TEXT,
      published_by_staff_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (reminder_id, version_number)
    );
    CREATE TABLE reminder_version_steps (
      id TEXT PRIMARY KEY,
      reminder_version_id TEXT NOT NULL REFERENCES reminder_versions(id) ON DELETE CASCADE,
      stable_step_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      offset_minutes INTEGER NOT NULL,
      message_type TEXT NOT NULL,
      message_content TEXT NOT NULL,
      offset_days INTEGER,
      send_at_time TEXT,
      template_id TEXT,
      target_condition_json TEXT NOT NULL DEFAULT '{}',
      action_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (reminder_version_id, stable_step_id)
    );
  `);
  return { sqlite, db: asD1(sqlite) };
}

const SETTINGS_A = {
  name: '予約前のお知らせ',
  steps: [
    { stableStepId: 's-1', offsetMinutes: 0, messageType: 'text', messageContent: 'Aの本文' },
  ],
} as never;

const SETTINGS_B = {
  name: '予約前のお知らせ',
  steps: [
    { stableStepId: 's-1', offsetMinutes: 0, messageType: 'text', messageContent: 'Bの古い本文' },
  ],
} as never;

function insertDraft(sqlite: Database.Database, reminderId: string, publishedId: string | null, versionId = 'v-1'): void {
  sqlite.prepare(
    `INSERT INTO reminders
       (id, name, is_active, created_at, updated_at, lifecycle_status,
        current_draft_version_id, current_published_version_id)
     VALUES (?, '予約前のお知らせ', 0, ?, ?, 'draft', ?, ?)`,
  ).run(reminderId, OLD_STAMP, OLD_STAMP, versionId, publishedId);
  sqlite.prepare(
    `INSERT INTO reminder_versions
       (id, reminder_id, version_number, status, settings_snapshot, created_at, updated_at)
     VALUES (?, ?, 1, 'draft', '{}', ?, ?)`,
  ).run(versionId, reminderId, OLD_STAMP, OLD_STAMP);
}

describe('R148 監査：共同編集の先勝ちを版時刻で守る', () => {
  it('同じ版IDでも、Aの保存後にBが古い版時刻で保存すると競合になり、Aの本文が残る', async () => {
    const { sqlite, db } = setup();
    insertDraft(sqlite, 'r-1', null);
    // A が保存する。通常保存は版IDを付け替えないが、版時刻は進む。
    const savedA = await saveReminderDraftVersion(db, 'r-1', SETTINGS_A, {
      expectedVersionId: 'v-1',
      expectedUpdatedAt: OLD_STAMP,
    });
    expect(savedA.id).toBe('v-1');
    expect(savedA.updated_at).not.toBe(OLD_STAMP);
    // B は開いたときの古い版時刻のまま保存する。版IDは同じだが止める。
    await expect(saveReminderDraftVersion(db, 'r-1', SETTINGS_B, {
      expectedVersionId: 'v-1',
      expectedUpdatedAt: OLD_STAMP,
    })).rejects.toThrow('REMINDER_DRAFT_CONFLICT');
    // A の本文が残っている（B の古い内容で上書きされていない）。
    const current = await db.prepare(
      `SELECT settings_snapshot AS s FROM reminder_versions WHERE id = 'v-1'`,
    ).bind().first<{ s: string }>();
    expect(current?.s).toContain('Aの本文');
    expect(current?.s).not.toContain('Bの古い本文');
  });

  it('版IDも版時刻も合っていれば保存できる（直列の保存は止めない）', async () => {
    const { sqlite, db } = setup();
    insertDraft(sqlite, 'r-1', null);
    const first = await saveReminderDraftVersion(db, 'r-1', SETTINGS_A, {
      expectedVersionId: 'v-1',
      expectedUpdatedAt: OLD_STAMP,
    });
    const second = await saveReminderDraftVersion(db, 'r-1', SETTINGS_B, {
      expectedVersionId: 'v-1',
      expectedUpdatedAt: first.updated_at,
    });
    expect(second.id).toBe('v-1');
  });

  it('条件を付けない保存は従来どおり通す', async () => {
    const { sqlite, db } = setup();
    insertDraft(sqlite, 'r-1', null);
    const saved = await saveReminderDraftVersion(db, 'r-1', SETTINGS_A);
    expect(saved.id).toBe('v-1');
  });
});

describe('R146 監査：未公開の下書きは再開できない', () => {
  it('公開版の無い下書きの再開は止まり、行は変わらない', async () => {
    const { sqlite, db } = setup();
    insertDraft(sqlite, 'r-1', null);
    await expect(updateReminder(db, 'r-1', { isActive: true }))
      .rejects.toThrow('REMINDER_NOT_PUBLISHED');
    const row = await getReminderById(db, 'r-1');
    expect(row?.is_active).toBe(0);
    expect(row?.lifecycle_status).toBe('draft');
  });

  it('公開版がある停止中は再開でき、止める方は未公開でも通す', async () => {
    const { sqlite, db } = setup();
    insertDraft(sqlite, 'r-1', 'pv-1');
    await updateReminder(db, 'r-1', { isActive: true });
    const resumed = await getReminderById(db, 'r-1');
    expect(resumed?.is_active).toBe(1);
    expect(resumed?.lifecycle_status).toBe('published');

    insertDraft(sqlite, 'r-2', null, 'v-2');
    await updateReminder(db, 'r-2', { isActive: false });
    const stopped = await getReminderById(db, 'r-2');
    expect(stopped?.is_active).toBe(0);
    expect(stopped?.lifecycle_status).toBe('stopped');
  });
});
