import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')
const SCREEN = `${PAGE}\n${OVERVIEWS}`

describe("管理画面 外部連携の運用者向け文言", () => {
  it('受信・送信の意味を日本語で判別できる', () => {
    expect(PAGE).toContain('こちらで受け取る')
    expect(PAGE).toContain('こちらから送る')
    expect(SCREEN).not.toContain('Incoming)')
    expect(SCREEN).not.toContain('Outgoing)')
  })

  it('作成画面と空状態から同じ操作名へ進める', () => {
    // 板 ：作る操作は小窓（Dialog）で出す。操作名は変えない。
    expect(PAGE).toContain('title="受け取る設定を追加"')
    expect(PAGE).toContain('受け取り口を作る')
    expect(PAGE).toContain('href="/webhooks/new"')
    expect(PAGE).not.toContain('送る設定を追加')
    expect(OVERVIEWS).toContain('最初の受け取り口を作る')
    expect(OVERVIEWS).toContain('最初の送り先を作る')
    expect(OVERVIEWS).not.toContain('右上の「受け取り口を追加」')
    expect(OVERVIEWS).not.toContain('右上の「送り先を追加」')
    expect(SCREEN).not.toContain('新規Webhook')
  })

  it('使えない操作をヘッダーに出さない', () => {
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('通知先の追加は準備中です')
    expect(PAGE).toContain('onClick={openCreate}')
  })

  it('取得失敗を0件や空と表示しない', () => {
    expect(OVERVIEWS).toContain("outgoingStatus === 'error'")
    expect(OVERVIEWS).toContain("incomingStatus === 'error'")
    expect(OVERVIEWS).toContain('登録内容は消えていません。')
    expect(OVERVIEWS).toContain('受け取り口を読み込めませんでした')
    expect(OVERVIEWS).toContain('onRetry={() => void reload()}')

  })
})
