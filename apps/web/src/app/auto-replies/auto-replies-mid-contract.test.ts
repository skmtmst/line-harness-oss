import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')
const RUNS = fs.readFileSync(new URL('../../v8/auto-replies/runs.tsx', import.meta.url), 'utf8')
const PUBLISH = fs.readFileSync(new URL('edit/wizard-v8.tsx', import.meta.url), 'utf8')
const EDITOR = fs.readFileSync(
  path.join(__dirname, '../../components/auto-replies/edit-dialog.tsx'),
  'utf8',
)

describe('点検・中: 自動応答の画面契約', () => {
  it('中3: 数え損ないを「未ヒット0回」に見せない', () => {
    expect(LIST).toContain('r.hits !== undefined')
  })

  it('中6: 言葉と本文の入力に上限を付ける', () => {
    expect(EDITOR).toContain('maxLength={200}')
    expect(EDITOR).toContain('maxLength={5000}')
  })

  it('中8: CSV書き出しは上限・件数・中断手段を持つ', () => {
    expect(RUNS).toContain('MAX_CSV_ROWS')
    expect(RUNS).toContain('5000')
    expect(RUNS).toContain('書き出しを止める')
    expect(RUNS).toContain('件を書き出しました')
    expect(RUNS).toContain('件読み込み中')
    expect(RUNS).toContain('期間を絞って分けてください')
  })

  it('中10: 送信者は探せて読み直せる。件数も出す', () => {
    expect(PUBLISH).toContain("loadFriendsInitial")
  })
})
