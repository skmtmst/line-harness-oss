/*
 * 1通目設定（設計 `管理画面 5 kk8dz`）の契約。
 *
 * 文字数・上限・保存の失敗・読み込みの状態の動きは first-step-audit.test.tsx が、
 * 下見の通番号は components/scenarios/step-preview-step-order.test.tsx が描いて守る。
 * ここは本文を手で広げられなくする書き方へ戻さない禁止の見張りだけを残す。
 */
import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(new URL('../../../v8/scenario-first-step/first-step.tsx', import.meta.url), 'utf8')

describe('1通目設定の動きの契約', () => {
  it('本文は手動でも広げられ、「本文」の字が入力欄と結び付く', () => {
    expect(PAGE).not.toContain('resize-none')
  })
})
