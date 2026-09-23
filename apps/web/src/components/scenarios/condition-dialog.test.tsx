// @vitest-environment happy-dom
/*
 * #616 SC-02c の回帰試験。
 *
 * 配信条件の窓で「現在の条件」が固定の見本（タグ「初回案内」かつ
 * 対応マーク「未対応」）を出し続け、下の「詳しい条件を編集」が見ている
 * 実際の下書き（空なら「絞り込みなし」）と食い違っていた。
 *
 * ここでは窓が実際の下書きと同じ値を出すことだけを見る：
 *   - 条件が無い → 「条件なし」。見本のタグ名・マーク名は出さない
 *   - 条件がある → 件数と行が下書きから組み立てられる
 *   - 削除・初期化 → 下書きと一緒に「条件なし」へ戻る
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はこの試験では使わない。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { ConditionDialog } from './scenario-dialogs'
import type { SegmentCondition } from '@/lib/segment-condition'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [] }),
}))

/*
 * 「詳しい条件を編集」の編集器（ConditionBuilder）は別部品で、選択肢取得の
 * 通信が要る。ここでは窓自身の表示だけを見るので描画は置き換える。
 * 形の関数（isEmptyCondition など）は窓の表示が使うので実物を渡す。
 */
vi.mock('@/components/shared/condition-builder', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/segment-condition')>(
      '@/lib/segment-condition',
    )
  return {
    default: () => <div data-testid="condition-builder" />,
    isEmptyCondition: actual.isEmptyCondition,
    isRuleComplete: actual.isRuleComplete,
    pruneCondition: actual.pruneCondition,
  }
})

afterEach(() => {
  cleanup()
})

function renderDialog(value: SegmentCondition | null) {
  return render(
    <ConditionDialog
      title="この通の配信対象"
      description="条件に合わない人には、この通だけ送りません。"
      value={value}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  )
}

describe('SC-02c: 「現在の条件」は実際の下書きを出す', () => {
  it('条件が無いときは「条件なし」。固定の見本は出さない', () => {
    renderDialog(null)
    expect(screen.getByText('現在の条件')).toBeTruthy()
    expect(document.body.textContent).toContain('条件なし')
    // 以前ここにあった固定の見本。実値と無関係なので出てはいけない。
    expect(document.body.textContent).not.toContain('初回案内')
    expect(document.body.textContent).not.toContain('未対応')
    expect(document.body.textContent).toContain('条件はまだありません')
  })

  it('条件があるときは件数と行が下書きから出る', () => {
    renderDialog({
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-1' },
        { type: 'support_mark', value: { markIds: ['mark-1'], exclude: false } },
      ],
    })
    expect(document.body.textContent).toContain('2 個の条件')
    expect(document.body.textContent).toContain('条件 1')
    expect(document.body.textContent).toContain('条件 2')
    expect(document.body.textContent).toContain('タグ')
    expect(document.body.textContent).toContain('対応マーク')
    expect(document.body.textContent).not.toContain('条件はまだありません')
  })

  it('or条件のかたまりも下書きから出る', () => {
    renderDialog({
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 'tag-1' }],
      groups: [{ operator: 'OR', rules: [{ type: 'is_hidden', value: false }] }],
    })
    expect(document.body.textContent).toContain('or条件のかたまり 1')
  })

  it('行の「削除」はその条件だけ外し、全部外すと「条件なし」へ戻る', () => {
    renderDialog({
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 'tag-1' }],
    })
    fireEvent.click(screen.getByText('削除'))
    expect(document.body.textContent).toContain('条件なし')
    expect(document.body.textContent).toContain('条件はまだありません')
  })

  it('「条件を初期化」は下書きごと空にして「条件なし」へ戻る', () => {
    renderDialog({
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 'tag-1' }],
    })
    fireEvent.click(screen.getByText('条件を初期化'))
    expect(document.body.textContent).toContain('条件なし')
  })
})
