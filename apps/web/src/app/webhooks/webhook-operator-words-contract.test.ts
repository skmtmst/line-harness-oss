import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = readFileSync(join(HERE, 'webhook-overviews.tsx'), 'utf8')
const SCREEN = `${PAGE}\n${OVERVIEWS}`

describe('V6 外部連携の運用者向け文言', () => {
  it('受信・送信の意味を日本語で判別できる', () => {
    expect(PAGE).toContain('こちらで受け取る')
    expect(PAGE).toContain('こちらから送る')
    expect(SCREEN).not.toContain('Incoming)')
    expect(SCREEN).not.toContain('Outgoing)')
  })

  it('作成画面と空状態から同じ操作名へ進める', () => {
    expect(PAGE).toContain('受け取る設定を作る')
    expect(PAGE).toContain("{showCreate ? 'キャンセル' : '＋ 受け取り口を作る'}")
    expect(PAGE).toContain('href="/webhooks/new">＋ 送り先を作る')
    expect(PAGE).not.toContain('送る設定を追加')
    expect(OVERVIEWS).toContain('「＋ 受け取り口を作る」から作成してください。')
    expect(OVERVIEWS).toContain('「＋ 送り先を作る」から作成してください。')
    expect(OVERVIEWS).not.toContain('右上の「受け取り口を追加」')
    expect(OVERVIEWS).not.toContain('右上の「送り先を追加」')
    expect(SCREEN).not.toContain('新規Webhook')
  })

  it('使えない操作をヘッダーに出さない', () => {
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('通知先の追加は準備中です')
    expect(PAGE).toContain('<Button variant="primary" onClick={() => setShowCreate(!showCreate)}>')
  })

  it('取得失敗を0件や空と表示しない', () => {
    // 失敗の枝は2つ（送る・受け取る）。件数（KPI）の「—」判定ぶん1つ増えた。
    expect(OVERVIEWS.match(/status === 'error'/g)).toHaveLength(3)
    expect(OVERVIEWS.match(/登録内容は消えていません。/g)).toHaveLength(2)
    // ★V7 `x63W5x`：古い個別ボタンではなく共通の再読み込み口（`onRetry`）。
    // ボタンの文言は共通部品（ListState）が持つ。ここでは口があることだけ見る。
    expect(OVERVIEWS).toContain('onRetry={onReload}')
  })
})
