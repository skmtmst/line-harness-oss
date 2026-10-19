import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

it('570は既存のひな形と版を残し、他の統括や削除済み分類への所属を拒否する', () => {
  const raw = new Database(':memory:')
  try {
    raw.pragma('foreign_keys=ON')
    raw.exec(readFileSync(new URL('../migrations/381_hq_templates.sql', import.meta.url),'utf8'))
    raw.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES ('t','own','tag','常連'); INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('v','own','t',1,'{}','h')")
    raw.exec(readFileSync(new URL('../migrations/570_hq_template_folders.sql', import.meta.url),'utf8'))
    expect(raw.prepare('SELECT id,folder_id FROM hq_templates').get()).toEqual({ id:'t', folder_id:null })
    expect(raw.prepare('SELECT id FROM hq_template_versions').get()).toEqual({ id:'v' })
    raw.exec("INSERT INTO hq_template_folders(id,tenant_id,name) VALUES ('f','own','季節'),('other','other','季節')")
    expect(() => raw.exec("UPDATE hq_templates SET folder_id='other' WHERE id='t'")).toThrow('HQ_FOLDER_SCOPE_INVALID')
    raw.exec("UPDATE hq_templates SET folder_id='f' WHERE id='t'")
    expect(() => raw.exec("INSERT INTO hq_template_folders(id,tenant_id,name) VALUES ('f2','own','季節')")).toThrow()
  } finally { raw.close() }
})
