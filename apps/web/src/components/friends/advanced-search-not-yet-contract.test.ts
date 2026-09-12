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

/** Pencil の OR 節に並ぶ11軸。 */
const OR_LABELS = [
  '対応マーク',
  'シナリオ',
  'イベント予約',
  'カレンダー予約',
  '回答フォーム',
  '最終反応日',
  'リマインダ',
  '個別メモ',
  'ステータスメッセージ',
  '友だち登録日',
  'その他',
]

describe('詳細条件のORの軸は、黙って消えない', () => {
  it('新契約へ接続する全軸が OR_AXES にある', () => {
    for (const label of OR_LABELS) {
      expect(DIALOG, `${label} が OR_AXES に無い`)
        .toContain(`{ label: '${label}',`)
    }
    expect(DIALOG).toContain('setAny((current) => [...current, condition])')
  })

  it('固定4状態と自由分類の対応マークを別の軸にする', () => {
    expect(DIALOG).toContain("chat_status: '対応状況'")
    expect(DIALOG).toContain("{ label: '対応マーク', make:")
  })

  it('選択肢待ちの軸だけ無効にし、理由を画面に出す', () => {
    const section = orSection()
    expect(section, 'OR節が見つからない').not.toBe('')
    expect(section).toContain('disabled={!condition}')
    expect(section).toContain('選択肢を読み込むと使えます')
    expect(section).not.toContain('title=')
  })

  it('表示する友だちと保存済み条件の入口を省かない', () => {
    expect(DIALOG).toContain('表示する友だち')
    expect(DIALOG).toContain('表示中')
    expect(DIALOG).toContain('非表示')
    expect(DIALOG).toContain('ブロックした人')
    expect(DIALOG).toContain('友だちの状態')
    expect(DIALOG).toContain('保存した検索から読み込む')
  })
})
