import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(new URL('../../../v8/common-vars/list.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('../../../v8/common-vars-edit/new.tsx', import.meta.url), 'utf8')
const EDIT_PAGE = readFileSync(new URL('../../../v8/common-vars-edit/edit.tsx', import.meta.url), 'utf8')
const API = readFileSync(join(HERE, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const WORKER = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'worker', 'src', 'routes', 'contents.ts'), 'utf8')

describe('V8共通情報一覧', () => {
  it('次回予約は一覧APIで受け取り、行ごとのAPI呼出をしない', () => {
    expect(PAGE).toContain('item.nextSchedule')
    expect(PAGE).not.toContain('api.commonVars.schedules(item.id)')
  })

  it('編集画面は詳細APIからメモ・版・履歴を読み、楽観ロック付きで保存する', () => {
    expect(EDIT_PAGE).toContain('api.commonVars.detail(id, accountAtRequest)')
    expect(EDIT_PAGE).toContain('setMemo(found.memo)')
    expect(EDIT_PAGE).toContain('item.history.slice(0, 5)')
    expect(EDIT_PAGE).toContain('expectedVersion: item.version')
    expect(EDIT_PAGE).not.toContain('メモを読み書きするAPIがまだありません')
    expect(EDIT_PAGE).not.toContain('変更者と変更前後を返す履歴APIがまだありません')
  })

  it('独立した詳細・フォルダ・予約の読み込みは並列に行う', () => {
    // R591: 並列のまま、結果は欄ごとに扱う。フォルダ・予定の失敗で
    // 詳細の結果まで捨てない（直列の滝に戻さない）。
    expect(EDIT_PAGE).toContain('await Promise.all([')
    expect(EDIT_PAGE).toContain('api.commonVars.detail(id, accountAtRequest)')
    expect(EDIT_PAGE).toContain("api.folders.list('common_var')")
    expect(EDIT_PAGE).toContain('api.commonVars.schedules(id, accountAtRequest)')
    expect(EDIT_PAGE).toContain('setFoldersError(true)')
    expect(EDIT_PAGE).toContain('setSchedulesError(true)')
  })

  it('一覧は空・期限つき・未使用の絞り込みとCSVを実際に操作できる', () => {
    expect(PAGE).toContain("setChip((currentChip) => (currentChip === next ? 'all' : next))")
    expect(PAGE).toContain("label: '使われている数が多い順'")
    // N-192: CSVは端末生成から監査台帳つきのサーバ出力へ切り替えた。
    expect(PAGE).toContain('VarsExportPanel')
    expect(API).toContain('createExport')
    expect(API).toContain('/api/common-vars/exports')
    expect(PAGE).toContain('が空のまま')
  })

  it('初回空と検索0件を言い分ける', () => {
expect(PAGE).toContain('まだ共通情報がありません')
    expect(PAGE).toContain('filtered={items.length > 0}')
    expect(PAGE).toContain('onClearFilters={clearVarFilters}')
  })

  it('削除前に使用先を確認し、API側も使用中の削除を止める', () => {
    expect(API).toContain('deleteImpact:')
    expect(PAGE).toContain('api.commonVars.deleteImpact(id, request.accountId)')
    expect(WORKER).toContain("code: 'common_var_delete_blocked'")
    expect(WORKER).toContain('getCommonVarUsageImpact')
  })

  it('選択中のLINEアカウントをすべての共通情報APIへ渡す', () => {
    expect(PAGE).toContain('api.commonVars.list(accountAtRequest)')
    expect(PAGE).toContain('latestAccountRef.current')
    expect(API).toContain('accountId=${encodeURIComponent(accountId)}')
    expect(WORKER).toContain("c.req.query('accountId')")
    expect(WORKER).toContain('canAccessAllLineAccounts')
    expect(WORKER).toContain('getCommonVarUsageSummaries')
  })

  it('新規・編集は未保存の入力を持ったまま出る操作を確認で止める（VAR-01 監査）', () => {
    // 文言は共通窓 UnsavedLeaveDialog が1つに持つ。画面側は subject の名詞だけを渡す。
    // 「戻る」で確認なしに入力が捨てられないよう、両画面で同じ契約を固定する。
    for (const [name, src] of [['新規', NEW_PAGE], ['編集', EDIT_PAGE]] as const) {
      expect(src, name).toContain('useUnsavedGuard')
      expect(src, name).toContain('UnsavedLeaveDialog')
      expect(src, name).toContain('leaveTarget !== null')
    }
    // 編集画面は影響確認（ImpactReview）へ切り替えた表示でも離脱確認が出る。
    expect(EDIT_PAGE).toContain('{leaveConfirmDialog}')
  })

  it('一覧・新規・編集は共通情報キーのゲートの内側にある(#862)', () => {
for (const path of ['page.tsx', 'new/page.tsx', 'edit/page.tsx']) {
      const entry = readFileSync(join(HERE, path), 'utf8');
      expect(entry).toContain('FeatureGate')
      expect(entry).toContain('feature="common_vars"')
    }
    const mediaEntry = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
    expect(mediaEntry).toContain('feature="media"')
  })
})
