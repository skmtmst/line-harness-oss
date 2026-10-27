import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 外部連携の運用者向け文言の禁止の見張り。タブの呼び名・作る導線・失敗の出し方は
 * webhook-tab-counts・webhook-role-gating-react と v8/webhooks/overview-behavior の試験が画面で確かめる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')
const SCREEN = `${PAGE}\n${OVERVIEWS}`

describe("管理画面 外部連携の運用者向け文言", () => {
  it('受信・送信を英語の括弧書きで出さない', () => {
    expect(SCREEN).not.toContain('Incoming)')
    expect(SCREEN).not.toContain('Outgoing)')
  })

  it('古い作る導線の呼び名と案内を戻さない', () => {
    expect(PAGE).not.toContain('送る設定を追加')
    expect(OVERVIEWS).not.toContain('右上の「受け取り口を追加」')
    expect(OVERVIEWS).not.toContain('右上の「送り先を追加」')
    expect(SCREEN).not.toContain('新規Webhook')
  })

  it('使えない操作をヘッダーに出さない', () => {
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('通知先の追加は準備中です')
  })
})
