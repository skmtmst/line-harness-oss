import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readApiSource } from '../../../scripts/test-api-source.mjs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = readUiSource(path.join(__dirname, '../../v8/friend-add/editor.tsx'), 'utf8')
const API = readApiSource(path.join(__dirname, '../../lib/api.ts'), 'utf8')

describe('友だち追加時配信の編集: 社内メモと実行条件の分離', () => {
  it('社内メモは internalMemo へ保存し、実行条件と共有しない', () => {
    expect(EDITOR).toContain('definition.internalMemo')
    expect(EDITOR).toContain('internalMemo: event.target.value')
    expect(EDITOR).toContain('配信の条件には使いません')
    expect(API).toContain('internalMemo?: string')
  })

  it('友だち条件は構造化 Condition Builder でJSONとして保存する', () => {
    expect(EDITOR).toContain('ConditionBuilder')
    expect(EDITOR).toContain('JSON.stringify(pruned)')
    expect(EDITOR).toContain('title="対象をしぼる" optional')
  })

  it('以前のメモ形式の条件は配信対象にせず、作り直しを促す', () => {
    expect(EDITOR).toContain("raw.trim() !== '' && parsed === null")
    expect(EDITOR).toContain('今は配信を止めています')
    expect(EDITOR).toContain('下の条件を作り直してください')
    // 自由文の入力例を出さない（例どおり書くと全員へ届く事故になる）
    expect(EDITOR).not.toContain('例: タグ')
  })
})
