import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'

it('既存配信を保ち、送り手・訂正元を保存し、重複と余分な個人情報を拒否する', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(`CREATE TABLE broadcasts(id TEXT PRIMARY KEY);
      CREATE TABLE line_senders(id TEXT PRIMARY KEY);
      INSERT INTO broadcasts VALUES ('old'), ('correction'), ('another');
      INSERT INTO line_senders VALUES ('sender');`)
    db.exec(readFileSync(new URL('../migrations/766_broadcast_sender_corrections.sql', import.meta.url), 'utf8'))
    expect(db.prepare('SELECT id FROM broadcasts ORDER BY id').all()).toEqual([{ id: 'another' }, { id: 'correction' }, { id: 'old' }])
    db.prepare(`INSERT INTO broadcast_sender_corrections
      (broadcast_id,sender_id,sender_snapshot_json,sent_by_staff_id,sent_by_staff_name,correction_of_broadcast_id,correction_request_key)
      VALUES (?,?,?,?,?,?,?)`).run('correction', 'sender', '{"name":"お知らせ係"}', 'staff', '担当者', 'old', 'request-1')
    expect(db.prepare('SELECT sent_by_staff_id,sent_by_staff_name,correction_of_broadcast_id FROM broadcast_sender_corrections').get()).toEqual({ sent_by_staff_id: 'staff', sent_by_staff_name: '担当者', correction_of_broadcast_id: 'old' })
    expect(() => db.prepare("INSERT INTO broadcast_sender_corrections(broadcast_id,correction_of_broadcast_id,correction_request_key) VALUES('another','old','request-1')").run()).toThrow()
    expect(() => db.prepare("INSERT INTO broadcast_sender_corrections(broadcast_id,sender_snapshot_json) VALUES('another',?)").run('{"name":"係","customer":"個人情報"}')).toThrow()
    expect(() => db.prepare("DELETE FROM broadcasts WHERE id='old'").run()).toThrow()
    db.prepare("DELETE FROM line_senders WHERE id='sender'").run()
    expect(db.prepare('SELECT sender_id,sender_snapshot_json FROM broadcast_sender_corrections').get()).toEqual({ sender_id: null, sender_snapshot_json: '{"name":"お知らせ係"}' })
    db.prepare("DELETE FROM broadcasts WHERE id='correction'").run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM broadcast_sender_corrections').get()).toEqual({ n: 0 })
  } finally { db.close() }
})
