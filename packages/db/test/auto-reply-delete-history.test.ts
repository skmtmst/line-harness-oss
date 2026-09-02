import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deleteAutoReply } from '../src/auto-replies.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query)
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = statement.run(...params)
              return { success: true, results: [], meta: { changes: result.changes } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('自動応答を削除した後の実行履歴', () => {
  it('ルールだけを削除し、過去に当たった記録は残す', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'))
    sqlite.prepare(
      `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content)
       VALUES ('rule-1', '予約', 'contains', 'text', 'ご予約ですね')`,
    ).run()
    sqlite.prepare(
      `INSERT INTO auto_reply_hits (id, auto_reply_id, matched_keyword)
       VALUES ('hit-1', 'rule-1', '予約')`,
    ).run()

    await deleteAutoReply(asD1(sqlite), 'rule-1')

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM auto_replies').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT auto_reply_id FROM auto_reply_hits').get()).toEqual({ auto_reply_id: 'rule-1' })
  })
})
