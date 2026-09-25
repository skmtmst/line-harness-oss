/*
 * 統合ユーザーの表は、表の外側の余白を左右で同じにする。
 *
 * 見出しの「操作」と各行の「詳細を見る」が右の枠にくっついて見えた。
 * 最後の列の右の余白を、最初の列の左の余白と同じ px-5 にそろえる。
 * 見出し行と本文行の両方でそろえないと、1440px で左右がずれる。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const TABLE = readFileSync(join(HERE, 'users-table.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, 'user-row.tsx'), 'utf8')

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('統合ユーザーの表の左右の余白', () => {
  it('見出し行の左端と右端は px-5', () => {
    const body = code(TABLE)
    expect(body).toContain('<Th className="pl-5">統合ユーザー</Th>')
    expect(body).toContain('<Th align="right" className="pr-5">操作</Th>')
  })

  it('本文行の左端と右端は px-5', () => {
    const body = code(ROW)
    expect(body).toContain('py-3 pr-3 pl-5 text-sm font-semibold text-ink')
    expect(body).toContain('py-3 pr-5 pl-3 text-right')
  })
})
