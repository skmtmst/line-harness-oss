import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTemplate, updateTemplate } from '../src/templates.js'
import { asD1 } from './d1-test-helper.js'

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '252_template_questions.sql'),
  'utf8',
)

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      message_type TEXT NOT NULL,
      message_content TEXT NOT NULL,
      folder_id TEXT,
      carousel_actions_json TEXT,
      carousel_tap_limit_mode TEXT NOT NULL DEFAULT 'none',
      carousel_tap_limit_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  sqlite.exec(migration)
  return sqlite
}

describe('migration 252 template questions', () => {
  it('stores a valid question and draft state through the template repository', async () => {
    const sqlite = setup()
    const questionJson = JSON.stringify({
      text: '続けますか？',
      tapMode: 'single',
      choices: [{ label: 'はい', behavior: 'none' }],
    })
    const created = await createTemplate(asD1(sqlite), {
      name: '継続確認',
      category: '定期便',
      messageType: 'text',
      messageContent: '続けますか？',
      questionJson,
      questionStatus: 'draft',
    })
    expect(created.question_json).toBe(questionJson)
    expect(created.question_status).toBe('draft')

    await updateTemplate(asD1(sqlite), created.id, { questionStatus: 'published' })
    expect(sqlite.prepare('SELECT question_status FROM templates WHERE id = ?').get(created.id))
      .toEqual({ question_status: 'published' })
  })

  it('rejects invalid JSON and an unknown publication state', () => {
    const sqlite = setup()
    expect(() => sqlite.prepare(`
      INSERT INTO templates
        (id, name, category, message_type, message_content, question_json, created_at, updated_at)
      VALUES ('bad-json', 'x', 'x', 'text', 'x', '{', '2026-08-29', '2026-08-29')
    `).run()).toThrow()
    expect(() => sqlite.prepare(`
      INSERT INTO templates
        (id, name, category, message_type, message_content, question_status, created_at, updated_at)
      VALUES ('bad-state', 'x', 'x', 'text', 'x', 'unknown', '2026-08-29', '2026-08-29')
    `).run()).toThrow()
  })
})
