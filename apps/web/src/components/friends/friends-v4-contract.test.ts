import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'page.tsx'), 'utf8')
const NAV = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'friends-nav-v8.tsx'), 'utf8')
const TABLE = readFileSync(join(HERE, 'friend-list-table.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, 'friend-list-row.tsx'), 'utf8')
const TABLE_CSS = readFileSync(join(HERE, 'friend-list-table.css'), 'utf8')
const KPIS = readFileSync(join(HERE, 'friend-kpis.tsx'), 'utf8')
const PAGINATION = readFileSync(join(HERE, '..', 'shared', 'pagination.tsx'), 'utf8')
const ADVANCED = readFileSync(join(HERE, 'advanced-search-dialog.tsx'), 'utf8')
/* N-039: 保存検索・通知の窓は overlay 規約へ乗せるため部品へ切り出した。 */
const SAVED_DIALOG = readFileSync(join(HERE, 'saved-search-dialog.tsx'), 'utf8')
const NOTICE_DIALOG = readFileSync(join(HERE, 'notice-dialog.tsx'), 'utf8')
const TIMELINE = readFileSync(join(HERE, 'friend-timeline.tsx'), 'utf8')
/* #984 LAY-14: 友だち配下の主タブの正本は friends-tabs.ts。 */
const FRIENDS_TABS = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'friends-tabs.ts'), 'utf8')
const DETAIL = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'detail', 'page.tsx'), 'utf8')
const DUPLICATES = readFileSync(join(HERE, '..', '..', 'app', 'duplicates', 'page.tsx'), 'utf8')
const USERS_TABLE = readFileSync(join(HERE, '..', 'users', 'users-table.tsx'), 'utf8')
const USER_ROW = readFileSync(join(HERE, '..', 'users', 'user-row.tsx'), 'utf8')
const USERS_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'users', 'page.tsx'), 'utf8')
const STRUCTURE = readFileSync(join(HERE, '..', '..', 'lib', 'design-structure.json'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('友だちV8の画面契約', () => {
  it('見出し下の説明を外して一覧を上へ詰める', () => {
    expect(PAGE).not.toContain('友だちの状態・配信状況・対応履歴を、1画面で確認して操作できます。')
  })
  it('友だち一覧をV8に完全切替する', () => {
    expect(PAGE).toContain('data-friends-page="v8"')
    expect(PAGE).toContain('data-design-node="ywJ5H"')
    expect(PAGE).toContain('data-friends-design="v8"')
    expect(PAGE).not.toContain('V2 2-2')
    expect(TABLE).not.toContain('V2 2-2')
    expect(ROW).not.toContain('V2 2-2')
    expect(KPIS).not.toContain('V2 2-2')
    expect(DETAIL).not.toContain('V2 2-2')
    expect(DETAIL).toContain('data-friends-detail-design="v4"')
    expect(STRUCTURE).toContain('"node": "ywJ5H"')
    expect(STRUCTURE).toContain('"node": "hsWaL"')
  })

  it('データ管理に移しても既存の行き先とCSV操作を残す', () => {
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<MergedTabs')
    expect(PAGE).toContain('<FriendsListHeadV8')
    // 主タブの項目は friends-tabs.ts が正本（#984 LAY-14。UID移行側も同じ一覧を使う）。
    expect(PAGE).toContain('FRIENDS_MERGED_TABS')
    expect(FRIENDS_TABS).toContain("{ key: 'duplicates', label: '重複検出'")
    expect(FRIENDS_TABS).toContain("{ key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' }")
    expect(NAV).toContain('CSVで書き出す')
    expect(PAGE).not.toContain('友だち管理のマニュアルは準備中です')
  })

  it('表示件数10〜50件と省略ページングを持つ', () => {
    expect(PAGE).toContain('const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50]')
    expect(TABLE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGINATION).toContain('paginationItems')
    expect(PAGINATION).toContain("return [1, 'ellipsis', current, 'ellipsis', total]")
    expect(PAGE).toContain('Math.ceil(total / pageSize)')
  })

  it('1440pxと1920pxで横スクロールを前提にしない', () => {
    expect(TABLE).not.toContain('overflow-x-auto')
    expect(TABLE).toContain('gridTemplateColumns')
    expect(TABLE).toContain("'--friend-cols'")
    expect(ROW).toContain('data-friend-cols')
    expect(TABLE).toContain('truncate')
    /* 夕14: v8 の 1366px 未満では流入元列を隠す（横送りより先に大事でない列を隠す）。 */
    expect(TABLE_CSS).toContain("data-theme='v8'")
    expect(TABLE_CSS).toContain('--friend-cols-narrow')
    expect(TABLE_CSS).toContain("data-column='source'")
    expect(ROW).toContain('data-column="source"')
  })

  it('一覧の不要な開く列を除き、件数・表示項目・表示件数を見出し右へ置く', () => {
    expect(PAGE).not.toContain('>一括アクション</button>')
    expect(ROW).toContain('<RowActions subjectName={friend.displayName}')
    expect(ROW).not.toContain('>開く<')
    expect(TABLE).toContain('表示項目を編集')
    // #668: 件数の選び口は共通部品 PageSizeSelect（「表示件数 N件」）。
    expect(TABLE).toContain('PageSizeSelect')
    expect(TABLE).toContain('truncate text-center')
    expect(ROW).toContain('items-center')
    expect(ROW).toContain('text-center')
  })

  it('V8でも検索・絞り込みの実行先を残す', () => {
    expect(PAGE).toContain('const SEARCH_ROW_SECONDARY')
    expect(PAGE).toContain('名前・LINE名・タグ・メモで探す')
    expect(PAGE).toContain('詳細条件')
    expect(PAGE).toContain('SavedSearchDialog')
    expect(SAVED_DIALOG).toContain('api.friendSavedViews.list')
    expect(PAGE).toContain('savedSearchId')
    expect(ADVANCED).toContain('この条件で表示')
    expect(PAGE).toContain('友だち追加の新しい順')
    /* 「担当者：すべて」は共通Selectの label + option から組み立てる。 */
    expect(PAGE).toContain('label="担当"')
    expect(PAGE).toContain('label="シナリオ"')
    expect(PAGE).toContain("{ value: '', label: 'すべて' }")
    expect(PAGE).toContain('注目のみ')
    expect(PAGE).toContain('data-design-node="ywJ5H"')
    expect(ADVANCED).toContain('z-[100]')
    expect(ADVANCED).toContain('現在の条件に一致')
    expect(ADVANCED).toContain('いずれか1つ以上満たす条件')
    expect(ADVANCED).toContain('条件を保存')
  })

  it('KPI・検索・一覧をPencilの実ノードへ結び付ける', () => {
    expect(KPIS).toContain('data-design-node="ywJ5H"')
    expect(TABLE).toContain('data-design-node="ywJ5H"')
    expect(KPIS).toContain('variant="v6"')
  })

  it('未対応・注目・表示列の選択状態を目と再読み込み後の両方で確認できる', () => {
    // m13i: 札の形は共通 FilterChip 1つにそろえた。目の選択表示は部品が持つ。
    expect(PAGE).toContain("selected={responseFilter === 'unhandled'}")
    expect(PAGE).toContain('selected={attentionOnly}')
    expect(TABLE).toContain("localStorage.getItem('friends.visibleColumns')")
    expect(TABLE).toContain("localStorage.setItem('friends.visibleColumns'")
    expect(API).toContain('JSON.stringify(metadata)')
    expect(API).not.toContain('JSON.stringify({ metadata })')
  })

  it('絞り込みをV8のコンパクトな幅に収める', () => {
    /* ★V8 ywJ5H：タグ・対応128px、担当・シナリオ144px。 */
    expect(PAGE).toContain('className="w-32 shrink-0" data-filter="tag"')
    expect(PAGE).toContain('className="w-32 shrink-0" data-filter="response"')
    expect(PAGE).toContain('className="w-36 shrink-0" data-filter="operator"')
    expect(PAGE).toContain('className="w-36 shrink-0" data-filter="scenario"')
    expect(PAGE).not.toContain('className="w-37.5 shrink-0"')
    expect(PAGE).not.toContain('className="min-w-[150px] flex-1"')
    expect(PAGE).not.toContain('className="min-w-[160px] flex-1"')
  })

  it('重複画面の密度を保ち、統合ユーザーはV6の実Nodeへ結び付ける', () => {
    expect(DUPLICATES).toContain('rounded-card')
    expect(DUPLICATES).toContain('border-hairline')
    expect(USERS_PAGE).toContain('data-design-node="r7eSi"')
    expect(USERS_TABLE).toContain('rounded-card')
    expect(USER_ROW).toContain('border-divider-soft')
    expect(USER_ROW).toContain('登録アカウント詳細')
  })

  it('友だち詳細から一括確認済み操作を除く', () => {
    expect(TIMELINE).not.toContain('すべて確認済みにする')
  })

  it('ブラウザ標準アラートを使わず独自ダイアログを出す', () => {
    expect(PAGE).not.toContain('window.alert')
    expect(PAGE).not.toContain('window.confirm')
    /* N-039: 通知・保存検索の窓は部品側へ。共通overlay規約（Esc・復元）に乗せる。 */
    for (const source of [NOTICE_DIALOG, SAVED_DIALOG]) {
      expect(source).toContain('role="dialog"')
      expect(source).toContain('aria-modal="true"')
      expect(source).toContain('useOverlayFocus')
    }
  })

  it('既存の検索・タグ・対応・詳細・受信箱への経路を残す', () => {
    for (const marker of [
      'api.friends.list',
      'api.tags.list',
      'AdvancedSearchDialog',
      'SingleFriendActions',
      '/friends/detail?id=',
      '/chats?friend=',
      '/accounts?tab=migration',
    ]) {
      expect(PAGE + ROW).toContain(marker)
    }
  })
})
