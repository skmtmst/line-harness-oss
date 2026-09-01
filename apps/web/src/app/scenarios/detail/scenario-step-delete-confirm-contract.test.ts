import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 dqFft シナリオの通を削除する確認', () => {
  it('ブラウザ標準confirmを使わず共通の取り消せない操作の窓を使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toContain("confirm('このステップを削除してもよいですか？')")
    expect(PAGE).toContain('<ConfirmDialog')
    expect(PAGE).toContain('destructive')
  })

  it('どの通・一緒に消えるもの・残る履歴・取り消せないことを読む前に削除させない', () => {
    expect(PAGE).toContain('通目を削除しますか？')
    expect(PAGE).toContain('その配信対象・送信後アクションが削除されます')
    expect(PAGE).toContain('到達済みの履歴は監査記録として残ります')
    expect(PAGE).toContain('この操作は取り消せません')
    expect(PAGE).toContain('confirmLabel="この通を削除"')
  })

  it('削除中の二重操作を止め、失敗しても窓を閉じず日本語で再試行を案内する', () => {
    expect(PAGE).toContain('if (!deleteStepTarget || deletingStepId) return')
    expect(PAGE).toContain('busy={deletingStepId !== null}')
    expect(PAGE).toContain('error={deleteStepError}')
    expect(PAGE).toContain('この通を削除できませんでした。状態を読み直してから')
    expect(PAGE).not.toContain("setError('ステップの削除に失敗しました')")
  })

  it('成功したときだけ窓を閉じ、一覧と到達実績を読み直す', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
    expect(PAGE).toContain('setDeleteStepTarget(null)')
    expect(PAGE).toContain('void loadScenario()')
    expect(PAGE).toContain('void reloadStats()')
  })
})
