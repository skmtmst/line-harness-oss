import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifyRuleValues, verifyRuleBindings } from '../../../scripts/verify-v8-rule-values.mjs'
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
describe('V8 の採用済みの値をCIで守る', () => {
  it('共通部品が決まりの変数を読む', () => {
    expect(verifyRuleBindings(file => readFileSync(new URL(`./${file}.module.css`, import.meta.url), 'utf8'))).toEqual([])
  })
  it('変数を無視して部品の高さが旧い31pxに戻った場合を検出する', () => {
    const errors = verifyRuleBindings(file => readFileSync(new URL(`./${file}.module.css`, import.meta.url), 'utf8') +
      (file === 'folder-panel' ? `[data-theme='v8'] .panel .add { height: 31px; }` : ''))
    expect(errors).toEqual(['folder-panel .panel .add height: 決まり var(--tpl-button-h) / 実際 31px'])
  })
  it('上書きと参照を解いた値が決まりと一致する', () => {
    expect(verifyRuleValues(css)).toEqual([])
  })
  it('別テーマ・要素限定・後ろのrootを全画面の上書きと誤認しない', () => {
    expect(verifyRuleValues(css + `:root { --tpl-tabs-h: 99px; }
      [data-theme='v7'] { --tpl-tabs-h: 99px; }
      [data-theme='v8'] .example { --tpl-tabs-h: 99px; }`)).toEqual([])
  })
  it('後から別の値に上書きされた場合を検出する', () => {
    expect(verifyRuleValues(css + `[data-theme="v8"] { --tpl-tabs-h: 32px; }`)).toEqual([
      '--tpl-tabs-h: 決まり 36px / 実際 32px',
    ])
  })
  it('影の参照先のずれをすべて検出する', () => {
    const errors = verifyRuleValues(css + `[data-theme='v8'] { --shadow-controls-pop: none; }`)
    expect(errors).toHaveLength(5)
  })
  it('未定義と循環参照を検出する', () => {
    expect(verifyRuleValues(css + `[data-theme='v8'] { --tpl-tabs-h: var(--missing); }`)[0]).toContain('未定義または循環')
    expect(verifyRuleValues(css + `[data-theme='v8'] { --tpl-tabs-h: var(--tpl-tabs-h); }`)[0]).toContain('未定義または循環')
  })
})
