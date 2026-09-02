import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOG = fs.readFileSync(path.join(__dirname, 'advanced-search-dialog.tsx'), 'utf8')

/**
 * 注釈を落とす。**「なぜ `title` をやめたか」を書いた注釈そのものが
 * `title={item.why}` という字面を含む**ので、素のまま見ると
 * 直したあとも「まだ隠している」と読めてしまう。
 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(DIALOG)

/** OR節だけを切り出す。AND側の同じ字面に当たらないようにする。 */
function orSection(): string {
  const at = CODE.indexOf('いずれか1つ以上満たす条件')
  if (at < 0) return ''
  const end = CODE.indexOf('</section>', at)
  return CODE.slice(at, end)
}

/** OR節が並べようとしている軸の名前。 */
const OR_LABELS = ['対応マーク', 'シナリオ', 'イベント予約', '回答フォーム', '最終反応日']

describe('詳細条件のORの軸は、黙って消えない', () => {
  it('並べようとしている軸が、すべて NOT_YET にある', () => {
    for (const label of OR_LABELS) {
      expect(DIALOG, `${label} を並べる側に書いているのに NOT_YET に項目が無い`)
        .toContain(`{ label: '${label}',`)
    }
  })

  it('対応マークの理由が書いてある', () => {
    expect(DIALOG).toContain("{ label: '対応マーク', why: '対応マークで絞る口がありません' }")
  })

  it('押せない理由が title ではなく画面に出ている', () => {
    const section = orSection()
    expect(section, 'OR節が見つからない').not.toBe('')
    expect(section, '理由を title に隠している').not.toContain('title={item.why}')
    expect(section, '理由を本文に出していない').toContain('{item.why}')
  })
})
