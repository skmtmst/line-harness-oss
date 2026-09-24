import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顧客へのお知らせ一覧の「出す・止める」確認窓の置き場所の見張り（#734）。
 *
 * 確認窓は一覧の行スイッチから開く。行は `expandedSetting` が無い状態で
 * 描画されるので、確認窓を編集画面だけの条件（`expandedSetting ? <>`）
 * の中に置くと、状態は立つが描画されず「押しても何も起きない」画面に
 * なる（staging で実際に起きた）。ここで二度と条件の中へ戻さない。
 */

const HERE = import.meta.dirname
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 注釈を落とした page.tsx（customer-notifications-v6-contract と同じやり方）。 */
const CODE = PAGE
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('お知らせの出す・止める確認窓の置き場所', () => {
  it('行スイッチは即時保存ではなく pendingToggle を立てる', () => {
    expect(CODE).toContain('onToggle={() => setPendingToggle(setting)}')
    // 確認なしの即時 save へ戻さない。
    expect(CODE).not.toContain('onToggle={() => void save(')
  })

  it('確認窓は編集画面の条件（expandedSetting）の外に置く', () => {
    const editorBlock = CODE.indexOf('expandedSetting ? <>')
    const dialog = CODE.indexOf('open={pendingToggle !== null}')
    const blockEnd = CODE.indexOf('</> : null}', editorBlock)
    expect(editorBlock).toBeGreaterThan(-1)
    expect(dialog).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(-1)
    expect(dialog).toBeGreaterThan(blockEnd)
  })

  it('実行は pendingToggle を閉じてから save に進む', () => {
    expect(CODE).toContain('setPendingToggle(null); void save(')
    expect(CODE).toContain('onCancel={() => setPendingToggle(null)}')
  })
})
