import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const tables = [
  'funnels', 'rt_menu_items', 'auto_replies', 'automation_definitions',
  'common_action_bindings', 'rt_google_posts', 'rt_google_connections',
  'rt_seat_waitlist', 'rt_tables', 'templates', 'traffic_pools',
  'account_handovers', 'friend_scenarios', 'scenarios', 'media_file_scans',
  'file_scan_configs', 'webhook_interaction_logs', 'booking_payments',
  'meet_consultations', 'rich_menu_groups', 'outgoing_webhooks', 'incoming_webhooks',
  'bookings', 'event_bookings', 'rt_reservations',
] as const;
const revision = (table: string) => table === 'scenarios' ? 'content_revision' : 'confirmation_revision';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number };
type SchemaObject = { type: string; name: string; sql: string };

it('既存行を保ち、指定した版の列だけを初期値 1 で追加する', () => {
  const db = new Database(':memory:');
  try {
    db.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    db.pragma('foreign_keys = OFF');
    db.pragma('ignore_check_constraints = ON');
    // 最新 bootstrap から対象列を外し、直前の実スキーマを再現する。
    for (const table of tables) db.exec(`ALTER TABLE ${quote(table)} DROP COLUMN ${quote(revision(table))}`);
    const triggers = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all() as SchemaObject[];
    // 既存行の準備中だけトリガーを外し、その後元どおりに戻す。
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${quote(trigger.name)}`);
    const beforeRows = new Map<string, unknown[]>();
    const beforeColumns = new Map<string, Column[]>();
    for (const table of tables) {
      const columns = db.pragma(`table_xinfo(${quote(table)})`) as Column[];
      beforeColumns.set(table, columns);
      const writable = columns.filter((column) => column.hidden === 0);
      const values = writable.map((column) => /INT|REAL|NUMERIC|DECIMAL/i.test(column.type) ? 1 : 'null');
      db.prepare(`INSERT INTO ${quote(table)} (${writable.map((c) => quote(c.name)).join(', ')}) VALUES (${writable.map(() => '?').join(', ')})`).run(...values);
      beforeRows.set(table, db.prepare(`SELECT * FROM ${quote(table)}`).all());
    }
    for (const trigger of triggers) db.exec(trigger.sql);
    const otherObjects = () => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type != 'table' ORDER BY type, name").all();
    const beforeOtherObjects = otherObjects();
    const otherTables = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all().filter((row) => !tables.includes((row as { name: typeof tables[number] }).name));
    const beforeOtherTables = otherTables();
    db.exec(readFileSync(new URL('../migrations/756_confirmation_revisions.sql', import.meta.url), 'utf8'));
    expect(otherTables()).toEqual(beforeOtherTables);
    expect(otherObjects()).toEqual(beforeOtherObjects);
    for (const table of tables) {
      const columns = db.pragma(`table_xinfo(${quote(table)})`) as Column[];
      const added = columns.find((column) => column.name === revision(table));
      expect(added).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0, hidden: 0 });
      expect(columns.filter((column) => column.name !== revision(table))).toEqual(beforeColumns.get(table));
      const oldNames = beforeColumns.get(table)!.filter((column) => column.hidden === 0).map((column) => quote(column.name));
      expect(db.prepare(`SELECT ${oldNames.join(', ')} FROM ${quote(table)}`).all()).toEqual(beforeRows.get(table));
      expect(db.prepare(`SELECT ${quote(revision(table))} AS revision FROM ${quote(table)}`).all()).toEqual([{ revision: 1 }]);
    }
  } finally {
    db.close();
  }
});
