import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error Node のソース検査を同じ故障注入で確認する。
import { inspectCopySource, inspectCopyTree } from '../../scripts/verify-copy-rules.mjs'

type Finding = { rule: string }
const rules = (source: string, filename = 'screen.tsx') => (inspectCopySource(source, filename) as Finding[]).map((item) => item.rule)

describe('画面の言葉の書き方の見張り', () => {
  it('全角の数字・「...」・ブラウザの確認窓を止める', () => {
    expect(rules("const label = 'この７日'")).toEqual(['fullwidth-digit'])
    expect(rules('const view = <p>読み込み中...</p>')).toEqual(['ascii-ellipsis'])
    expect(rules("const more = '...'")).toEqual(['ascii-ellipsis'])
    expect(rules('const title = `${name}を保存しています...`')).toEqual(['ascii-ellipsis'])
    expect(rules("if (confirm('消しますか')) remove()")).toEqual(['browser-confirm'])
    expect(rules("window.alert('保存しました')")).toEqual(['browser-alert'])
    expect(rules("globalThis.confirm('消しますか')")).toEqual(['browser-confirm'])
  })

  it('決まりどおりの書き方と、画面に出ない文字は通す', () => {
    expect(rules("const label = 'この7日'; const view = <p>読み込み中…</p>")).toEqual([])
    // 全角の数字を半角へ直す正規表現、受け取った値との比較、英字だけの省略は画面の文ではない。
    expect(rules("const half = (value: string) => value.replace(/[０-９]/g, toHalf)")).toEqual([])
    expect(rules("const legacy = (child: unknown) => child === '...'")).toEqual([])
    expect(rules("const spread = { ...rest }; const path = '../..'")).toEqual([])
    // 共通の確認窓や、名前に confirm を含む別の関数は止めない。
    expect(rules("api.confirm(id); onConfirm(); <ConfirmDialog onConfirm={save} />")).toEqual([])
  })

  it('決まりの文書は文言を変えないので読まず、画面のファイルは読む', () => {
    const root = mkdtempSync(join(tmpdir(), 'copy-rules-'))
    try {
      mkdirSync(join(root, 'apps/web/src/content/terms'), { recursive: true })
      mkdirSync(join(root, 'apps/liff/src/pages'), { recursive: true })
      writeFileSync(join(root, 'apps/web/src/content/terms/musubo-terms.ts'), "export const TERMS = '第１条'")
      writeFileSync(join(root, 'apps/liff/src/pages/done.tsx'), 'export const Done = () => <p>送信中…</p>')
      expect(inspectCopyTree(root).errors).toEqual([])
      writeFileSync(join(root, 'apps/liff/src/pages/done.tsx'), 'export const Done = () => <p>送信中...</p>')
      expect((inspectCopyTree(root).errors as Finding[]).map((item) => item.rule)).toEqual(['ascii-ellipsis'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('管理画面と LIFF の製品ソースに違反がない', () => {
    // pathname は百分率符号化されるので、作業場所の名前に日本語や空白があると読めない。
    expect(inspectCopyTree(fileURLToPath(new URL('../../../../', import.meta.url))).errors).toEqual([])
  })
})
