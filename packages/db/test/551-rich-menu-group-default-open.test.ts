import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('rich_menu_groups に「トークを開いたとき開いておく」の列を足し、既存行は閉じておくのままにする', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE rich_menu_groups (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        chat_bar_text TEXT NOT NULL,
        size TEXT NOT NULL
      );
      INSERT INTO line_accounts VALUES ('account');
      INSERT INTO rich_menu_groups VALUES ('menu-1', 'account', 'メニュー', 'メニュー', 'large');
    `);
    const migration = readFileSync(new URL('../migrations/551_rich_menu_group_default_open.sql', import.meta.url), 'utf8');
    db.exec(migration);
    // 既存行は 0（閉じておく＝従来の LINE への出し方）を保つ。
    expect(db.prepare('SELECT default_open FROM rich_menu_groups WHERE id = ?').get('menu-1'))
      .toEqual({ default_open: 0 });
    // 新しい行は「開いておく」を選べる。省略しても 0 になる。
    db.prepare("INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size, default_open) VALUES ('menu-2', 'account', 'B', 'メニュー', 'compact', 1)").run();
    db.prepare("INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size) VALUES ('menu-3', 'account', 'C', 'メニュー', 'compact')").run();
    expect(db.prepare('SELECT id, default_open FROM rich_menu_groups ORDER BY id').all())
      .toEqual([
        { id: 'menu-1', default_open: 0 },
        { id: 'menu-2', default_open: 1 },
        { id: 'menu-3', default_open: 0 },
      ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); }
});
