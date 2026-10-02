import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('価格承認への移行', () => {
  it('既存の公開・停止済みメニューを保護し、公開履歴が不明な旧下書きも保護する', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(readFileSync(new URL('../migrations/168_restaurant_test_foundation.sql', import.meta.url), 'utf8'));
      db.exec(`INSERT INTO rt_organizations (id, account_id, name) VALUES ('org', 'account', '確認');
        INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store', 'org', '確認', 'S');
        INSERT INTO rt_menu_items (id, store_id, kind, name, price, status) VALUES
          ('active', 'store', 'course', '公開', 1000, 'active'),
          ('archived', 'store', 'course', '停止', 1000, 'archived'),
          ('draft', 'store', 'course', '下書き', 1000, 'draft');`);
      db.exec(readFileSync(new URL('../migrations/546_restaurant_menu_approval.sql', import.meta.url), 'utf8'));
      expect(db.prepare('SELECT id, published_once FROM rt_menu_items ORDER BY id').all()).toEqual([
        { id: 'active', published_once: 1 }, { id: 'archived', published_once: 1 }, { id: 'draft', published_once: 0 },
      ]);
      expect(db.prepare("SELECT publication_history_unknown FROM rt_menu_items WHERE id = 'draft'").get()).toEqual({ publication_history_unknown: 1 });
      db.exec("UPDATE rt_menu_items SET status = 'active' WHERE id = 'draft'; UPDATE rt_menu_items SET status = 'draft' WHERE id = 'draft';");
      expect(db.prepare("SELECT published_once FROM rt_menu_items WHERE id = 'draft'").get()).toEqual({ published_once: 1 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
