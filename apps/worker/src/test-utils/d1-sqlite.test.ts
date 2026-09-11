/*
 * createTestD1 が組み立てるDBの「出来上がり」を固定する(#720)。
 *
 * #720 で、ファイルDBの pragma を schema を流す**前**へ移した。速さのための
 * 変更だが、出来上がりが変わっていないことを言えなければ意味がない。ここは
 * 所要を測らない(時間に依存する試験は間欠的に落ちる)。代わりに、
 * **bootstrap.sql をそのまま流しただけのDB**を正本に置き、createTestD1 が
 * 返すDBの sqlite_master がそれと一字一句一致することを見る。
 *
 * 次に誰かが createTestD1 の順序や pragma を触ったとき、出来上がりが変わる
 * なら、ここが赤くなる。
 */
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestD1 } from './d1-sqlite.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BOOTSTRAP_PATH = join(__dirname, '../../../../packages/db/bootstrap.sql')

const tempDirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'd1-sqlite-test-'))
  tempDirs.push(dir)
  return join(dir, 'test.sqlite')
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

/** sqlite_master をそのまま並べたもの。一字でも違えば文字列が変わる。 */
function schemaDump(raw: Database.Database): string {
  return JSON.stringify(
    raw.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all(),
  )
}

/** 正本: bootstrap.sql を pragma 無しでそのまま流しただけのDB。 */
function referenceSchemaDump(): string {
  const raw = new Database(':memory:')
  try {
    raw.exec(readFileSync(BOOTSTRAP_PATH, 'utf8'))
    return schemaDump(raw)
  } finally {
    raw.close()
  }
}

describe('createTestD1 の出来上がり', () => {
  test('bootstrap.sql をそのまま流したものと、sqlite_master が一致する(:memory:)', () => {
    const { raw } = createTestD1()
    try {
      expect(schemaDump(raw)).toBe(referenceSchemaDump())
    } finally {
      raw.close()
    }
  })

  test('ファイルDBでも、sqlite_master は同じ(pragma を先に立てても変わらない)', () => {
    const { raw } = createTestD1({ file: tempFile() })
    try {
      expect(schemaDump(raw)).toBe(referenceSchemaDump())
    } finally {
      raw.close()
    }
  })

  test('foreignKeys を立てても、sqlite_master は同じ', () => {
    const { raw } = createTestD1({ foreignKeys: true })
    try {
      expect(schemaDump(raw)).toBe(referenceSchemaDump())
    } finally {
      raw.close()
    }
  })

  test('空ではない。表も索引も引き金も入っている', () => {
    const { raw } = createTestD1()
    try {
      const counts = raw
        .prepare("SELECT type, COUNT(*) AS c FROM sqlite_master GROUP BY type ORDER BY type")
        .all() as { type: string; c: number }[]
      const byType = Object.fromEntries(counts.map((row) => [row.type, row.c]))
      expect(byType.table).toBeGreaterThan(100)
      expect(byType.index).toBeGreaterThan(100)
      expect(byType.trigger).toBeGreaterThan(0)
    } finally {
      raw.close()
    }
  })

  test('ファイルDBは WAL・synchronous=OFF・busy_timeout=2000 で開いている', () => {
    const { raw } = createTestD1({ file: tempFile() })
    try {
      expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(raw.pragma('synchronous', { simple: true })).toBe(0)
      expect(raw.pragma('busy_timeout', { simple: true })).toBe(2000)
    } finally {
      raw.close()
    }
  })

  test('attach は schema を流さず、既にあるDBへ繋ぐだけ', () => {
    const file = tempFile()
    const first = createTestD1({ file })
    first.raw.prepare("INSERT INTO tags (id, name) VALUES ('tag-1', '体験申込')").run()
    first.raw.close()

    const second = createTestD1({ file, attach: true })
    try {
      // 流し直していれば、既にある表を作ろうとして落ちるか、行が消える。
      expect(schemaDump(second.raw)).toBe(referenceSchemaDump())
      const row = second.raw.prepare("SELECT name FROM tags WHERE id = 'tag-1'").get() as
        | { name: string }
        | undefined
      expect(row?.name).toBe('体験申込')
    } finally {
      second.raw.close()
    }
  })

  test('foreign_keys は options のとおりに立つ', () => {
    const off = createTestD1()
    const on = createTestD1({ foreignKeys: true })
    try {
      expect(off.raw.pragma('foreign_keys', { simple: true })).toBe(0)
      expect(on.raw.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      off.raw.close()
      on.raw.close()
    }
  })
})
