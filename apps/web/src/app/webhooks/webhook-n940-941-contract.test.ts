import { readUiSource } from '../../../scripts/test-ui-source.mjs'
/*
 * #941（N-385〜N-388）の残りの見張り。
 *
 * 設定メニューのキーボード操作・試し送信の確認は v8/webhooks/overview-behavior.test.tsx、
 * まとめて再試行の残りの知らせと詳細の窓に残る値は v8/webhooks/interactions-behavior.test.tsx が画面で確かめる。
 * ここには描画の試験では見えない CSS の1行省略と、直接送る押し口の禁止だけを残す。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')
const STYLES = readFileSync(join(import.meta.dirname, '../../v8/webhooks/interactions.module.css'), 'utf8')

describe('N-386: 狭い幅では重要度の低い列を隠し、情報は詳細で見られる', () => {
  it('V8では名前列を伸ばし、短い文字列は1行で省略する', () => {
    expect(STYLES).toContain('min-width: 0;')
    expect(STYLES).toContain('text-overflow: ellipsis;')
    expect(STYLES).toContain('white-space: nowrap;')
  })
})

describe('N-388: 試し送信は送り先を確かめてから送る', () => {
  it('「試してみる」ボタンは直接送らず確認へ回す', () => {
    expect(OVERVIEWS).not.toContain('onClick={() => void runTest(item)}')
  })
})
