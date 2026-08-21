import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const APP_SHELL = join(ROOT, '..', 'app-shell.tsx')
const DASHBOARD = join(ROOT, '..', '..', 'app', 'page.tsx')
const DASHBOARD_EDITOR = join(ROOT, '..', 'dashboard', 'dashboard-editor.tsx')
const PENDING_INBOX = join(ROOT, '..', 'support', 'pending-inbox-card.tsx')
const FRIEND_TREND = join(ROOT, '..', 'dashboard', 'friend-trend-table.tsx')
const CHATS = join(ROOT, '..', '..', 'app', 'chats', 'page.tsx')
const MENU = join(ROOT, '..', '..', 'lib', 'menu.ts')

describe('Pen.dev V4を共通レイアウトの正本にする', () => {
  const shell = readFileSync(APP_SHELL, 'utf8')
  const dashboard = readFileSync(DASHBOARD, 'utf8')
  const dashboardEditor = readFileSync(DASHBOARD_EDITOR, 'utf8')
  const pendingInbox = readFileSync(PENDING_INBOX, 'utf8')
  const friendTrend = readFileSync(FRIEND_TREND, 'utf8')
  const chats = readFileSync(CHATS, 'utf8')
  const menu = readFileSync(MENU, 'utf8')

  it('1920pxでサイドバー256px・本体1664px・左右40pxになる', () => {
    expect(shell).toContain('data-design-shell="v4-1920"')
    expect(shell).toContain('max-w-shell')
    expect(shell).toContain('lg:px-10')
    expect(shell).not.toContain('lg:px-8')
  })

  it('V4の上段と主要カードが実装から消えていない', () => {
    for (const label of [
      '今日やること',
      '対応が必要な受信',
      '写真審査',
      '今日の予約',
      '出荷予定',
      '今月の送信枠',
      '運用アラート',
      '接続状態',
      '友だち数の推移',
      '友だち追加リンク',
    ]) expect(dashboard).toContain(label)
  })

  it('V4カードの影は右1px・下1pxで統一する', () => {
    expect(dashboard).toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
    expect(dashboard).not.toContain('shadow-[1px_2px_2px_rgba(29,29,31,0.13)]')
  })

  it('編集画面は矢印ではなくドラッグ・表示切替・プレビューで操作する', () => {
    for (const label of ['カードと配置', 'プレビュー', '最大4枚まで', '変更を適用']) {
      expect(dashboardEditor).toContain(label)
    }
    expect(dashboardEditor).toContain('useSortable')
    expect(dashboardEditor).toContain("DashboardGroup = 'today' | 'main' | 'right'")
    expect(dashboardEditor).not.toContain('上へ移動')
    expect(dashboardEditor).not.toContain('下へ移動')
  })

  it('対応が必要な受信はV4の4列だけを出し、件数に合わせて高さを縮める', () => {
    for (const label of ['お名前', '内容', '待ち時間', '状態', 'h-fit', 'PAGE_SIZE = 5', '前のページ', '次のページ']) {
      expect(pendingInbox).toContain(label)
    }
    expect(pendingInbox).not.toContain('h-[440px]')
    expect(pendingInbox).toContain('offset=${(page - 1) * PAGE_SIZE}')
    expect(pendingInbox).not.toContain('一括で確認済みにする')
    expect(pendingInbox).not.toContain('すべて選択')
  })

  it('ダッシュボード見出しの補足文を表示しない', () => {
    expect(dashboard).not.toContain('運用状況です。')
  })

  it('見出しと受信一覧の余白を詰める', () => {
    expect(dashboard).toContain('data-design="Head" className="mb-4 flex')
    expect(dashboard).not.toContain('min-h-[76px]')
    expect(pendingInbox).toContain('h-[61px]')
  })

  it('推定の説明は表の下ではなく各日のヘルプに表示する', () => {
    expect(friendTrend).toContain('role="tooltip"')
    expect(friendTrend).toContain('group-hover:block')
    expect(friendTrend).not.toContain('border-t px-5 py-3')
    expect(friendTrend).toContain('Date.UTC(year, month - 1, day)')
  })

  it('ダッシュボードの名前からLINE・メールそれぞれの受信内容を開く', () => {
    expect(pendingInbox).toContain('/chats?channel=email&thread=')
    expect(pendingInbox).toContain('/chats?friend=')
    expect(chats).toContain("params.get('thread')")
  })

  it('V4で追加したメニューが実装から消えていない', () => {
    for (const label of ['コンバージョン', '専用機能', 'NEN配信', '写真審査', 'EC連携', 'データ移行']) {
      expect(menu).toContain(label)
    }
  })
})
