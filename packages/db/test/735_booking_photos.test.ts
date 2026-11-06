import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../migrations/735_booking_photos.sql', import.meta.url), 'utf8');
const oldKinds = ['template', 'broadcast', 'rich_menu', 'scenario_step', 'nen_column', 'event', 'webinar'];

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE media(id TEXT PRIMARY KEY,line_account_id TEXT,kind TEXT,archived_at TEXT);
    CREATE TABLE menus(id TEXT PRIMARY KEY,line_account_id TEXT,deleted_at TEXT);
    CREATE TABLE staff(id TEXT PRIMARY KEY,line_account_id TEXT,deleted_at TEXT);
    CREATE TABLE booking_settings(id TEXT PRIMARY KEY,line_account_id TEXT);
    CREATE TABLE media_usages(media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      ref_kind TEXT NOT NULL CHECK(ref_kind IN ('template','broadcast','rich_menu','scenario_step','nen_column','event','webinar')),
      ref_id TEXT NOT NULL,scanned_at TEXT NOT NULL DEFAULT 'old-default',PRIMARY KEY(media_id,ref_kind,ref_id));
    CREATE INDEX idx_media_usages_media_scanned ON media_usages(media_id,scanned_at);
    INSERT INTO media VALUES('p','a','image',NULL),('p-more','a','image',NULL),('other','b','image',NULL),('shared',NULL,'image',NULL),('video','a','video',NULL),('archived','a','image','2026-10-01');`);
  return db;
}

describe('735 予約写真（未適用SQLの検証）', () => {
  it('旧7種類の2000行の内容・時刻と複合主キー・外部キー・走査索引を保つ', () => {
    const db = setup();
    try {
      const insert = db.prepare('INSERT INTO media_usages VALUES(?,?,?,?)');
      for (let i = 0; i < 2000; i++) insert.run('p', oldKinds[i % oldKinds.length], String(i), `before-${i}`);
      const before = db.prepare('SELECT * FROM media_usages ORDER BY ref_id').all();
      db.transaction(() => db.exec(migration))();
      expect(db.prepare('SELECT * FROM media_usages ORDER BY ref_id').all()).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_media_usages_media_scanned'").get()).toBeTruthy();
      expect(() => insert.run('p', 'template', '0', 'duplicate')).toThrow(/UNIQUE/);
      expect(() => insert.run('missing', 'booking_menu', 'm', 'now')).toThrow(/FOREIGN KEY/);
      expect(() => insert.run('p', 'unknown', 'm', 'now')).toThrow(/CHECK/);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });
  it('写真と使用先を同じ書込で保存・解除し、複数の枠で同じ写真を保護する', () => {
    const db = setup();
    try {
      db.exec(migration);
      db.exec(`INSERT INTO menus(id,line_account_id,photo_media_id) VALUES('m','a','p');
        INSERT INTO staff(id,line_account_id,photo_media_id) VALUES('s','a','p');
        INSERT INTO booking_settings(id,line_account_id,store_photo_media_id,store_photo_interior_media_id)
          VALUES('bs','a','p','p');`);
      expect(db.prepare('SELECT ref_kind FROM media_usages ORDER BY ref_kind').all()).toEqual([
        { ref_kind: 'booking_menu' }, { ref_kind: 'booking_settings' }, { ref_kind: 'booking_staff' },
      ]);
      db.exec("UPDATE booking_settings SET store_photo_media_id=NULL; UPDATE menus SET photo_media_id='p-more'; UPDATE staff SET deleted_at='gone';");
      expect(db.prepare("SELECT ref_kind FROM media_usages WHERE media_id='p'").all()).toEqual([{ ref_kind: 'booking_settings' }]);
      db.exec('UPDATE booking_settings SET store_photo_interior_media_id=NULL; DELETE FROM menus;');
      expect(db.prepare('SELECT * FROM media_usages').all()).toEqual([]);
    } finally { db.close(); }
  });
  it.each(['other', 'shared', 'video', 'archived', 'missing'])('API検査と保存の間に変わってもSQLが不正な写真 %s を拒否する', id => {
    const db = setup();
    try {
      db.exec(migration);
      expect(() => db.prepare("INSERT INTO menus(id,line_account_id,photo_media_id) VALUES('m','a',?)").run(id)).toThrow('booking_photo_media_unavailable');
      expect(() => db.prepare("INSERT INTO staff(id,line_account_id,photo_media_id) VALUES('s','a',?)").run(id)).toThrow('booking_photo_media_unavailable');
      expect(() => db.prepare("INSERT INTO booking_settings(id,line_account_id,store_photo_interior_media_id) VALUES('bs','a',?)").run(id)).toThrow('booking_photo_media_unavailable');
      expect(db.prepare('SELECT * FROM media_usages').all()).toEqual([]);
    } finally { db.close(); }
  });
  it.each(['[]', '["exterior","exterior","waiting"]', '[null,"interior","waiting"]', '["exterior","interior","waiting","extra"]'])('順番の不正な形をDBでも拒否: %s', order => {
    const db = setup();
    try {
      db.exec(migration);
      expect(() => db.prepare("INSERT INTO booking_settings(id,line_account_id,store_photo_order_json) VALUES('bs','a',?)").run(order)).toThrow(/CHECK/);
    } finally { db.close(); }
  });
});
