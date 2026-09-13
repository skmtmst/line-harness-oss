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
const CARD = join(ROOT, '..', 'shared', 'card.module.css')

describe('Pen.dev V6を共通レイアウトの正本にする', () => {
  const shell = readFileSync(APP_SHELL, 'utf8')
  const dashboard = readFileSync(DASHBOARD, 'utf8')
  const dashboardEditor = readFileSync(DASHBOARD_EDITOR, 'utf8')
  const pendingInbox = readFileSync(PENDING_INBOX, 'utf8')
  const friendTrend = readFileSync(FRIEND_TREND, 'utf8')
  const chats = readFileSync(CHATS, 'utf8')
  const menu = readFileSync(MENU, 'utf8')
  const card = readFileSync(CARD, 'utf8')

  it('1920pxでV5正式共通メニューと本体幅の契約を使う', () => {
    expect(shell).toContain('data-design-shell="v6-1920"')
    expect(shell).toContain('data-design-node="J33xq"')
    expect(shell).toContain('styles.content')
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

  it('カードの影はV5共通部品から右1px・下1pxで統一する', () => {
    expect(dashboard).toContain("import Card, { CardHeader } from '@/components/shared/card'")
    expect(card).toContain('box-shadow: var(--shadow-card)')
    expect(dashboard).not.toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
  })

  it('編集画面は矢印ではなくドラッグ・表示切替・プレビューで操作する', () => {
    // 2026-09-03: 設計 `ZN0ov` は「「今日やること」は4枠までです」と書く。
    for (const label of ['表示するカードと位置を変更します', 'カードと配置', 'プレビュー', '4枠までです', 'ダッシュボードに反映']) {
      expect(dashboardEditor).toContain(label)
    }
    for (const label of ['上部・小カード', 'メイン・横長', 'メイン・左カラム']) {
      expect(dashboardEditor).toContain(label)
    }
    expect(dashboardEditor).toContain('useSortable')
    expect(dashboardEditor).toContain("DashboardGroup = 'today' | 'main' | 'right'")
    expect(dashboardEditor).not.toContain('上へ移動')
    expect(dashboardEditor).not.toContain('下へ移動')
  })

  it('対応が必要な受信はV4の4列だけを出し、件数に合わせて高さを縮める', () => {
    for (const label of ['お名前', '内容', '待ち時間', '状態', 'h-fit']) {
      expect(pendingInbox).toContain(label)
    }
    expect(pendingInbox).not.toContain('h-[440px]')
    /*
      1ページの数は**固定にしない**。5件に固定していたころ、総数5件でも
      2行しか出せず、残りへ行く手段が無かった。設計（`NjK9q`）は表示件数を
      選べて、下に番号のページ送りが出る。ページ送りは共通部品へ寄せた。
    */
    expect(pendingInbox).toContain('PAGE_SIZE_OPTIONS')
    expect(pendingInbox).toContain('表示件数')
    expect(pendingInbox).toContain("from '@/components/shared/pagination'")
    expect(pendingInbox).toContain('offset=${(page - 1) * pageSize}')
    expect(pendingInbox).not.toContain('一括で確認済みにする')
    expect(pendingInbox).not.toContain('すべて選択')
  })

  it('ダッシュボード見出しの補足文を表示しない', () => {
    expect(dashboard).not.toContain('運用状況です。')
  })

  it('ダッシュボードの画面名はV6共通トップバーだけに置く', () => {
    expect(dashboard).not.toContain("import Header from '@/components/layout/header'")
    expect(dashboard).not.toContain('<Header')
    expect(dashboard).not.toContain('title="ダッシュボード"')
    expect(dashboard).toContain('V6 `vUXKb/vwcM6`')
    expect(dashboard).toContain('ダッシュボード編集')
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

  it('V4で追加した店舗運用メニューが実装から消えていない', () => {
    // D-3で統括へ集約した「アカウント」「データ移行」は店舗メニューの対象外。
    for (const label of ['コンバージョン', '専用機能', 'NEN配信', '写真審査', 'EC連携']) {
      expect(menu).toContain(label)
    }
  })
})
