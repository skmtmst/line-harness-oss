import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('V6 外部連携の運用者向け文言', () => {
  it('受信・送信の意味を日本語で判別できる', () => {
    expect(PAGE).toContain('こちらで受け取る')
    expect(PAGE).toContain('こちらから送る')
    expect(PAGE).not.toContain('Incoming)')
    expect(PAGE).not.toContain('Outgoing)')
  })

  it('作成画面と空状態から同じ操作名へ進める', () => {
    expect(PAGE).toContain('受け取る設定を追加')
    expect(PAGE).toContain('送る設定を追加')
    expect(PAGE.match(/Webhookを追加/g)?.length).toBeGreaterThanOrEqual(3)
    expect(PAGE).not.toContain('新規Webhook')
  })

  it('使えない操作をヘッダーに出さない', () => {
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('通知先の追加は準備中です')
    expect(PAGE).toContain('<Button variant="primary" onClick={() => setShowCreate(!showCreate)}>')
  })

  it('取得失敗を0件や空と表示しない', () => {
    expect(PAGE).toContain("activeStatus === 'error'")
    expect(PAGE).toContain('登録内容は消えていません。')
    expect(PAGE).toContain('{activeLabel}を再読み込み')
  })
})
