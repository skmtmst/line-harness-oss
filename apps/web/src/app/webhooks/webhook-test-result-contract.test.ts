import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERVIEWS = readFileSync(join(HERE, 'webhook-overviews.tsx'), 'utf8')

/**
 * #506「中」W1 の契約(試し送信の結果表示)。
 *
 * 以前は `api.webhooks.outgoing.test()` の戻り値を読まず、成功も失敗も
 * 画面に何も出なかった。成功は届いた旨、失敗は「やり取りの記録」タブへの
 * 案内を共通 Notice で出す。
 */
describe('試し送信の結果表示(#506 中 W1)', () => {
  it('試し送信の戻りを読み、届いたかで文言を分ける', () => {
    expect(OVERVIEWS).toContain('response.data.delivered')
    expect(OVERVIEWS).toContain('への試し送信が届きました')
    expect(OVERVIEWS).toContain('への試し送信は届きませんでした')
    expect(OVERVIEWS).toContain('への試し送信に失敗しました')
  })

  it('失敗時は「やり取りの記録」タブへ案内する', () => {
    expect(OVERVIEWS).toContain('「やり取りの記録」タブで詳しく確認できます')
  })

  it('結果は共通 Notice で出し、閉じられる', () => {
    expect(OVERVIEWS).toContain("import Notice, { type NoticeTone } from '@/components/shared/notice'")
    expect(OVERVIEWS).toContain('<Notice tone={testNotice.tone}')
    expect(OVERVIEWS).toContain('setTestNotice(null)')
  })
})
