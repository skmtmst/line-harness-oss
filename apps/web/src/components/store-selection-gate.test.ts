import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const gate = readFileSync(new URL('./store-selection-gate.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./app-shell.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('./layout/sidebar.tsx', import.meta.url), 'utf8')

describe('店舗未選択の共通ゲート', () => {
  it('AppShellの1か所で子画面のマウントを止める', () => {
    expect(shell).toContain('<StoreSelectionGate>{children}</StoreSelectionGate>')
    expect(gate).toContain("decision === 'block-unselected'")
    expect(gate).toContain("decision === 'show'")
  })

  it('読み込み中と未選択を区別し、統括へ案内する', () => {
    expect(gate).toContain("decision === 'wait'")
    expect(gate).toContain('店舗が選ばれていません')
    expect(gate).toContain('この画面は店舗ごとのデータを扱います。統括の店舗一覧から店舗を選んでください。')
    expect(gate).toContain('href="/hq"')
    expect(gate).toContain('店舗を選ぶ')
    expect(gate).toContain('data-design="Empty"')
  })

  it.each(['/friends', '/chats', '/tags', '/templates', '/rich-menus', '/form-submissions'])('%sの個別実装ではなく共通入口で守る', (pathname) => {
    expect(pathname).toMatch(/^\//)
    expect(shell.match(/<StoreSelectionGate/g)).toHaveLength(1)
  })

  it('店舗未選択中はサイドバーの店舗別件数取得も始めない', () => {
    expect(sidebar).toContain('if (!selectedAccountId)')
    expect(sidebar).toContain('setUnansweredCount(0)')
    expect(sidebar).toContain('}, [selectedAccountId])')
  })
})
