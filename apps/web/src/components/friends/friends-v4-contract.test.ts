import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'page.tsx'), 'utf8')
const TABLE = readFileSync(join(HERE, 'friend-list-table.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, 'friend-list-row.tsx'), 'utf8')
const KPIS = readFileSync(join(HERE, 'friend-kpis.tsx'), 'utf8')
const SUMMARY_CARD_CSS = readFileSync(join(HERE, '..', 'shared', 'summary-card.module.css'), 'utf8')
const PAGINATION = readFileSync(join(HERE, '..', 'shared', 'pagination.tsx'), 'utf8')
const ADVANCED = readFileSync(join(HERE, 'advanced-search-dialog.tsx'), 'utf8')
const TIMELINE = readFileSync(join(HERE, 'friend-timeline.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'detail', 'page.tsx'), 'utf8')
const DUPLICATES = readFileSync(join(HERE, '..', '..', 'app', 'duplicates', 'page.tsx'), 'utf8')
const USERS_TABLE = readFileSync(join(HERE, '..', 'users', 'users-table.tsx'), 'utf8')
const USER_ROW = readFileSync(join(HERE, '..', 'users', 'user-row.tsx'), 'utf8')
const USERS_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'users', 'page.tsx'), 'utf8')
const STRUCTURE = readFileSync(join(HERE, '..', '..', 'lib', 'design-structure.json'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('友だちV6の画面契約', () => {
  it('見出し下の説明を外して一覧を上へ詰める', () => {
    expect(PAGE).not.toContain('友だちの状態・配信状況・対応履歴を、1画面で確認して操作できます。')
  })
  it('V2の固定値ではなくV6を画面の正本にする', () => {
    expect(PAGE).toContain('data-friends-page="v6"')
    expect(PAGE).toContain('data-design-node="PhxG6"')
    expect(PAGE).toContain('data-friends-design="v6"')
    expect(PAGE).not.toContain('V2 2-2')
    expect(TABLE).not.toContain('V2 2-2')
    expect(ROW).not.toContain('V2 2-2')
    expect(KPIS).not.toContain('V2 2-2')
    expect(DETAIL).not.toContain('V2 2-2')
    expect(DETAIL).toContain('data-friends-detail-design="v4"')
    expect(STRUCTURE).toContain('"node": "PhxG6"')
    expect(STRUCTURE).toContain('"node": "hsWaL"')
  })

  it('画面名はトップバーだけに置き、V6のタブと操作を同じ行に置く', () => {
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).toContain('data-design="V6Tabs"')
    expect(PAGE).toContain('data-design-node="JB0Ki"')
    expect(PAGE).toContain("{ key: 'duplicates', label: '重複検出' }")
    expect(PAGE).toContain("{ key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' }")
    expect(PAGE).toContain('actions={')
    expect(PAGE).toContain('CSVで書き出す')
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
    expect(ROW).toContain('style={{ gridTemplateColumns }}')
    expect(TABLE).toContain('truncate')
  })

  it('V6のカード影と操作色を守る', () => {
    for (const source of [PAGE, TABLE]) {
      expect(source).toContain('shadow-card')
    }
    expect(KPIS).toContain("import SummaryCard from '@/components/shared/summary-card'")
    expect(SUMMARY_CARD_CSS).toContain('box-shadow: var(--shadow-card)')
    expect(PAGE).toContain('text-action')
    expect(PAGE).toContain('bg-accent')
  })

  it('一覧の不要な開く列を除き、件数・表示項目・表示件数を見出し右へ置く', () => {
    expect(PAGE).not.toContain('>一括アクション</button>')
    expect(TABLE).not.toContain('>操作<')
    expect(ROW).not.toContain('>開く<')
    expect(TABLE).toContain('表示項目を編集')
    expect(TABLE).toContain('件表示')
    expect(TABLE).toContain('truncate text-center')
    expect(ROW).toContain('items-center')
    expect(ROW).toContain('text-center')
  })

  it('V6の検索・絞り込みの名前と実行先を固定する', () => {
    expect(PAGE).toContain('const SEARCH_ROW_SECONDARY')
    expect(PAGE).toContain('名前・LINE名・タグ・メモで検索')
    expect(PAGE).toContain('詳細条件')
    expect(PAGE).toContain('SavedSearchDialog')
    expect(PAGE).toContain('api.savedSearches.list')
    expect(PAGE).toContain('savedSearchId')
    expect(ADVANCED).toContain('この条件で表示')
    expect(PAGE).toContain('友だち追加の新しい順')
    /* 「担当者：すべて」は共通Selectの label + option から組み立てる。 */
    expect(PAGE).toContain('label="担当者"')
    expect(PAGE).toContain('label="シナリオ"')
    expect(PAGE).toContain("{ value: '', label: 'すべて' }")
    expect(PAGE).toContain('注目のみ')
    expect(PAGE).toContain('data-design-node="pRHvc"')
    expect(ADVANCED).toContain('z-[100]')
    expect(ADVANCED).toContain('現在の条件に一致')
    expect(ADVANCED).toContain('いずれか1つ以上満たす条件')
    expect(ADVANCED).toContain('条件を保存')
  })

  it('KPI・検索・一覧をPencilの実ノードへ結び付ける', () => {
    expect(KPIS).toContain('data-design-node="zZMNG"')
    expect(TABLE).toContain('data-design-node="k4Hz0X"')
    expect(KPIS).toContain('variant="v6"')
  })

  it('未対応・注目・表示列の選択状態を目と再読み込み後の両方で確認できる', () => {
    expect(PAGE).toContain("responseFilter === 'unhandled' ? 'bg-status-danger-selected ring-2")
    expect(PAGE).toContain('aria-pressed={attentionOnly}')
    expect(TABLE).toContain("localStorage.getItem('friends.visibleColumns')")
    expect(TABLE).toContain("localStorage.setItem('friends.visibleColumns'")
    expect(API).toContain('JSON.stringify(metadata)')
    expect(API).not.toContain('JSON.stringify({ metadata })')
  })

  it('絞り込みをV6の固定幅に収め、右側へ引き伸ばさない', () => {
    /*
      2026-09-02: 幅を設計の実寸へ直した。150/150/160/160 は実装側の痩せで、
      設計 `PhxG6` はタグ156 / 対応156 / 担当者176 / シナリオ184。
    */
    expect(PAGE).toContain('className="w-39 shrink-0" data-filter="tag"')
    expect(PAGE).toContain('className="w-39 shrink-0" data-filter="response"')
    expect(PAGE).toContain('className="w-44 shrink-0" data-filter="operator"')
    expect(PAGE).toContain('className="w-46 shrink-0" data-filter="scenario"')
    expect(PAGE).not.toContain('className="w-37.5 shrink-0"')
    expect(PAGE).not.toContain('className="min-w-[150px] flex-1"')
    expect(PAGE).not.toContain('className="min-w-[160px] flex-1"')
  })

  it('重複画面の密度を保ち、統合ユーザーはV6の実Nodeへ結び付ける', () => {
    expect(DUPLICATES).toContain('rounded-[14px]')
    expect(DUPLICATES).toContain('#DADDE2')
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
    expect(PAGE).toContain('role="dialog"')
    expect(PAGE).toContain('aria-modal="true"')
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
