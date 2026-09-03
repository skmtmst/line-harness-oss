import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const SETTINGS = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('V6 友だち追加時配信・実行結果の契約', () => {
  it('実ノードと実行結果への往復導線を持つ', () => {
    expect(PAGE).toContain('data-design-node="P2J0Te"')
    expect(PAGE).toContain("usePageTitle('友だち追加時配信・実行結果')")
    expect(PAGE).not.toContain('<Header')
    expect(SETTINGS).toContain('<Button href="/friend-add-settings/runs">実行結果を見る</Button>')
    expect(PAGE).toContain('<Button href="/friend-add-settings">配信設定へ戻る</Button>')
  })

  it('選択中のアカウントと3つの絞り込みだけをAPIへ渡す', () => {
    expect(PAGE).toContain('api.friendAddRouting.events(selectedAccountId')
    expect(PAGE).toContain("kind: kind === 'all' ? undefined : kind")
    expect(PAGE).toContain("attributionStatus: attribution === 'all' ? undefined : attribution")
    expect(PAGE).toContain("routingStatus: routing === 'all' ? undefined : routing")
    expect(PAGE).not.toContain('accounts[0]')
  })

  it('アカウントを切り替えたあとの古い応答を表示しない', () => {
    expect(PAGE).toContain('const requestId = ++requestSequence.current')
    expect(PAGE).toContain('if (requestId !== requestSequence.current) return')
    expect(PAGE.indexOf('const requestId = ++requestSequence.current')).toBeLessThan(PAGE.indexOf('if (!selectedAccountId)'))
  })

  it('読込・空・失敗・アカウント未選択を同じ状態にしない', () => {
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('LINE公式アカウントを選んでください')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('条件に合う実行結果はありません')
    expect(PAGE).toContain('もう一度読み込む')
  })

  it('未取得の経路を0件や推測した経路として表示しない', () => {
    expect(PAGE).toContain("'経路は取得できません'")
    expect(PAGE).toContain("item.entryRouteName || item.refCode || '選択した経路'")
    expect(PAGE).not.toContain('entryRouteId}')
    expect(PAGE).not.toContain("'公式QRから追加'")
  })

  it('4つの処理状態を利用者の言葉で表示する', () => {
    expect(PAGE).toContain("pending: { label: '処理中です'")
    expect(PAGE).toContain("completed: { label: '動きました'")
    expect(PAGE).toContain("failed: { label: '確認が必要です'")
    expect(PAGE).toContain("suppressed: { label: '配信しませんでした'")
  })

  it('カーソルを積んだページ送りで前後へ移動できる', () => {
    expect(PAGE).toContain('setCursorStack((current) => current.length > 1 ? current.slice(0, -1) : current)')
    expect(PAGE).toContain('setCursorStack((current) => [...current, data.nextCursor])')
    expect(PAGE).toContain('disabled={!data.nextCursor || loading}')
  })
})
