/*
 * 送信後アクションの窓の動きの契約（動作ごとの設定・作れる動作・下書き保存）。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(path.join(__dirname, 'action-editor.tsx'), 'utf8')

describe('V6 送信後アクションの契約', () => {
  /*
   * 設計はセクションに1つだが、`repeatOnRefire` は動作1件ごとの列。
   * 1つにまとめると動作ごとに違う値を持てず、既にある設定を黙って
   * 上書きすることになる。動作ごとのまま残す。
   */
  it('「発動2回目以降も実行する」は動作ごとに置いたままにする', () => {
    expect(EDITOR).toContain('checked={action.repeatOnRefire}')
    expect(EDITOR).toContain('発動2回目以降も実行する')
  })

  /*
   * 設計の8種類をすべて保存できる札として並べる。
   */
  it('作れる動作だけを並べる', () => {
    const kinds = EDITOR.slice(
      EDITOR.indexOf('export const ACTION_KINDS'),
      EDITOR.indexOf('const KIND_LABEL'),
    )
    expect(kinds.match(/type: '/g)).toHaveLength(9)
    expect(kinds).toContain("type: 'send_message'")
    expect(kinds).toContain("type: 'send_template'")
    expect(kinds).toContain("type: 'reminder'")
    expect(kinds).toContain("type: 'event_booking'")
  })

  it('変更後の安全な設定をV6下書きAPIへ保存する', () => {
    expect(EDITOR).toContain('api.scenarios.getDraft(scenarioId, selectedAccountId)')
    expect(EDITOR).toContain('api.scenarios.saveDraft(scenarioId')
    expect(EDITOR).toContain('expectedVersion: draftVersion')
    expect(EDITOR).toContain('afterActions: toDraftActions(next)')
    expect(EDITOR).toContain('変更時にV6下書きへ保存')
  })
})
