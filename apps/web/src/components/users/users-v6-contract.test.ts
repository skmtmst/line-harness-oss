import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'users', 'page.tsx'), 'utf8')
const TABLE = readFileSync(join(HERE, 'users-table.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, 'user-row.tsx'), 'utf8')
const SUMMARY = readFileSync(join(HERE, 'summary-bar.tsx'), 'utf8')
const FILTERS = readFileSync(join(HERE, 'users-filters.tsx'), 'utf8')

describe('統合ユーザーV6の画面契約', () => {
  it('Pencilの実Nodeと利用者向けの7列へ結び付ける', () => {
    expect(PAGE).toContain('data-users-design="v6"')
    expect(PAGE + TABLE).toContain('data-design-node="r7eSi"')
    for (const heading of [
      '統合ユーザー',
      '連絡先',
      '紐付くアカウント',
      'UID',
      '最終接触',
      '重複配信',
      '操作',
    ]) {
      expect(TABLE).toContain(`>${heading}</Th>`)
    }
  })

  it('内部の統合キーを画面へ出さない', () => {
    expect(ROW).not.toContain('{row.identityKey}')
    expect(ROW).not.toContain('{row.identityKeyKind}')
    expect(ROW).toContain('UID: {shortenUid(a.lineUserId)}')
    expect(ROW).toContain("{expanded ? '閉じる' : '詳細を見る'}")
    expect(PAGE).not.toContain('画像トークン')
    expect(PAGE).not.toContain('worker キャッシュ')
    expect(FILTERS).toContain('UIDで検索')
  })

  it('複数登録を配信済みと決めつけず要確認として出す', () => {
    expect(ROW).toContain("row.isDuplicate ? '要確認' : '対象外'")
    expect(ROW).not.toContain('2通→1通')
    expect(ROW).toContain('送信前に配信先の確認が必要です')
  })

  it('空・読込・失敗を同じ表示にしない', () => {
    expect(TABLE).toContain('<ListState kind="loading" />')
    expect(TABLE).toContain('kind="error"')
    expect(TABLE).toContain('kind="empty"')
    expect(TABLE).toContain('統合ユーザーを表示できませんでした')
    expect(TABLE).toContain('const countAvailable = !loading && !error')
    expect(TABLE).toContain(": '—人'")
  })

  it('KPI名を統合ユーザーの業務用語へそろえる', () => {
    /* 面は共通SummaryCardへ移したので、名前は title= で渡す。 */
    for (const label of ['統合ユーザー', '紐付く友だち', '重複している行', '重複率']) {
      expect(SUMMARY).toContain(`title="${label}"`)
    }
    expect(SUMMARY).not.toContain('余分な行数')
    expect(SUMMARY).not.toContain('余分率')
  })

  it('KPIの読み込み中・取得失敗・取得成功を分け、失敗を0件にしない', () => {
    expect(SUMMARY).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(SUMMARY).toContain('data-summary-state={status}')
    expect(SUMMARY).toContain('value={stats?.uniquePeople ?? null}')
    expect(SUMMARY).toContain('setStats(null)')
    expect(SUMMARY).toContain('requestGuard.isCurrent(requestGeneration)')
  })

  it('共通ページ送りを使い横スクロールへ逃がさない', () => {
    expect(TABLE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(TABLE).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    expect(TABLE).not.toContain('overflow-x-auto')
    expect(TABLE).toContain('table-fixed')
  })
})
