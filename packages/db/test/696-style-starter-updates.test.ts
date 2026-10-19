import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('696 preserves existing account choices and provenance, leaves old samples unclassified, and validates JSON', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE account_styles(line_account_id TEXT PRIMARY KEY,cards_json TEXT);INSERT INTO account_styles VALUES('a','[{"id":"ledger","visible":false}]');
  CREATE TABLE style_starter_items(line_account_id TEXT,style TEXT,item_key TEXT,target_id TEXT,set_id TEXT,set_version INTEGER);INSERT INTO style_starter_items VALUES('a','salon','welcome','t','set',2)`);
    db.exec(
      readFileSync(
        new URL(
          '../migrations/696_style_starter_updates_and_dashboard_metrics.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(db.prepare('SELECT * FROM style_starter_items').get()).toEqual({
      line_account_id: 'a',
      style: 'salon',
      item_key: 'welcome',
      target_id: 't',
      set_id: 'set',
      set_version: 2,
      source_snapshot: null,
      pending_update: null,
    });
    expect(db.prepare('SELECT * FROM account_styles').get()).toEqual({
      line_account_id: 'a',
      cards_json: '[{"id":"ledger","visible":false}]',
      metrics_json: null,
    });
    for (const [table, column] of [
      ['style_starter_items', 'source_snapshot'],
      ['style_starter_items', 'pending_update'],
      ['account_styles', 'metrics_json'],
    ])
      expect(() => db.exec(`UPDATE ${table} SET ${column}='invalid'`)).toThrow(
        /CHECK/,
      );
  } finally {
    db.close();
  }
});
