import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
const tables = ['hq_template_folders', 'hq_broadcast_folders', 'friend_add_rule_folders']
const sql = readFileSync(new URL('../migrations/613_folder_colors.sql', import.meta.url), 'utf8')
describe('613: フォルダの色を足す実SQL', () => {
  it.each(tables)('%s は既存行を残してNULLを許し、6桁の16進数だけ受ける', (table) => {
    const db = new Database(':memory:')
    try {
      for (const name of tables) db.exec(`CREATE TABLE ${name}(id TEXT PRIMARY KEY, name TEXT); INSERT INTO ${name} VALUES('old','既存')`)
      db.exec(sql)
      expect(db.prepare(`SELECT * FROM ${table}`).get()).toEqual({ id: 'old', name: '既存', color: null })
      const update = db.prepare(`UPDATE ${table} SET color=? WHERE id='old'`)
      for (const color of ['#3b82f6', '#ABCDEF', '#000000', null]) {
        update.run(color)
        expect(db.prepare(`SELECT color FROM ${table}`).get()).toEqual({ color })
      }
      for (const color of ['red', '#123', '#1234567', '#12345g', '#12345_', '1234567', '', '#12 456']) expect(() => update.run(color)).toThrow(/CHECK/)
    } finally { db.close() }
  })
})
