import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../../components/scenarios/scenario-list.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ開始・停止確認', () => {
  it('V6実Nodeと共通確認ダイアログを使う', () => {
    expect(PAGE).toContain('data-design-node="RUxNf"')
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).toContain('<ConfirmDialog')
  })

  it('対象名・購読中人数・通数・履歴が残ることを確認する', () => {
    expect(PAGE).toContain('toggleTarget.name')
    expect(PAGE).toContain('toggleTarget.subscriberCount')
    expect(PAGE).toContain('toggleTarget.stepCount')
    expect(PAGE).toContain('これまでの配信履歴は残ります。')
  })

  it('開始は広い事前確認、停止は危険操作の共通窓に分ける', () => {
    expect(PAGE).toContain('<StartScenarioDialog')
    expect(PAGE).toContain('開始するシナリオ')
    expect(PAGE).toContain('開始後に起きること')
    expect(PAGE).toContain('confirmLabel="シナリオを停止"')
    expect(PAGE).toContain('destructive')
  })

  it('失敗時は窓を閉じず、内部エラーを出さずに再試行できる', () => {
    expect(PAGE).toContain('setToggleError(')
    expect(PAGE).toContain('シナリオを停止できませんでした。')
    expect(PAGE).toContain('シナリオを開始できませんでした。')
    expect(PAGE).toContain('error={toggleError || undefined}')
  })

  it('ブラウザ標準confirmを開始・停止に使わない', () => {
    expect(LIST).not.toContain('すべてのアカウントに影響します。続けますか？')
    expect(LIST).toContain('onToggleActive(s.id, s.isActive)')
  })
})
