import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * V6R-S2-c: フォルダの並べ替えは、2つの PATCH ではなくサーバの1回の入れ替えで行う。
 * 2回に分けると、1回目だけ成功したときに同じ番号のフォルダが2つ残る。
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGES = ['app/templates/page.tsx', 'app/broadcasts/page.tsx']

describe('フォルダの並べ替えは1回の入れ替えで行う（V6R-S2-c）', () => {
  for (const file of PAGES) {
    it(`${file} は swapOrder を使い、displayOrder を2回に分けて送らない`, () => {
      const source = readFileSync(join(SRC, file), 'utf8')
      const move = source.slice(source.indexOf('const moveFolder'), source.indexOf('\n  }\n', source.indexOf('const moveFolder')))
      expect(move).toContain('api.folders.swapOrder(target.id, neighbor.id')
      expect(move).not.toMatch(/api\.folders\.update\([^)]*displayOrder/)
    })
  }
})
