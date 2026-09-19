// @vitest-environment happy-dom
/*
 * Issue #968（U004-U007 / U024 / U025 / U088-U090）の契約試験。
 *
 * - U004: 足す・外すはローカル下書きだけを動かし、「開始条件を保存」で
 *   まとめて反映、「キャンセル」で元に戻る。
 * - U005: 開始する友だちの条件は固定文ではなく実データから作る。
 * - U006: 選べない開始回数の2択を廃し、固定仕様の説明にする。
 * - U024/U025/U090: 固定列・固定幅ポップオーバー・固定高さをソースで禁止。
 * - U088/U089: 共通 Dialog を使い、名前の無い × を置かない。
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TriggerEditor from './trigger-editor'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listTriggers = vi.hoisted(() => vi.fn())
const addTrigger = vi.hoisted(() => vi.fn())
const removeTrigger = vi.hoisted(() => vi.fn())
const simulate = vi.hoisted(() => vi.fn())
const fetchTags = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: {
    scenarios: {
      triggers: { list: listTriggers, add: addTrigger, remove: removeTrigger },
      simulate,
    },
  },
}))

vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: { tags: fetchTags },
}))

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'trigger-editor.tsx'), 'utf8')

const SAVED = [
  { id: 'trig-1', kind: 'friend_add', tagId: null },
  { id: 'trig-2', kind: 'tag_added', tagId: 'tag-1' },
] as const

const renderEditor = async (props: Partial<Parameters<typeof TriggerEditor>[0]> = {}) => {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  render(
    <TriggerEditor
      scenarioId="sc-1"
      onClose={onClose}
      onChanged={onChanged}
      lineAccountId="acc-1"
      {...props}
    />,
  )
  // 一覧の読み込みが終わるまで待つ。
  await screen.findByText('友だち追加時')
  // 人数の試算など、残っている非同期の更新も流し切る。
  await act(async () => {})
  return { onClose, onChanged }
}

beforeEach(() => {
  listTriggers.mockResolvedValue({ success: true, data: [...SAVED] })
  addTrigger.mockResolvedValue({ success: true, data: [...SAVED] })
  removeTrigger.mockResolvedValue({ success: true, data: null })
  simulate.mockResolvedValue({
    success: true,
    data: {
      audience: { matched: 10, alreadySubscribed: 2, newStartPlanned: 8, excluded: 3 },
      steps: [],
    },
  })
  fetchTags.mockResolvedValue({
    success: true,
    data: [
      { id: 'tag-1', name: '初回案内' },
      { id: 'tag-2', name: '購入済' },
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('U004: 開始条件のキャンセル', () => {
  it('外してもキャンセルで元に戻る。下書きは保存までAPIへ送らない', async () => {
    const { onClose } = await renderEditor()

    fireEvent.click(screen.getAllByText('外す')[0])
    expect(screen.getByText('未保存の変更があります。', { exact: false })).toBeTruthy()
    expect(removeTrigger).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('キャンセル'))
    expect(onClose).toHaveBeenCalled()
    expect(removeTrigger).not.toHaveBeenCalled()
    expect(addTrigger).not.toHaveBeenCalled()
  })

  it('タグを足してもキャンセルで元に戻る', async () => {
    const { onClose } = await renderEditor()

    fireEvent.change(screen.getByLabelText('きっかけにするタグ'), { target: { value: 'tag-2' } })
    fireEvent.click(screen.getByText('＋ このタグが付いたとき'))
    expect(addTrigger).not.toHaveBeenCalled()
    expect(screen.getByText('タグ「購入済」が付いたとき')).toBeTruthy()

    fireEvent.click(screen.getByText('キャンセル'))
    expect(onClose).toHaveBeenCalled()
    expect(addTrigger).not.toHaveBeenCalled()
    // キャンセル後の再読み込みも起きない（何も変えていない）。
    expect(listTriggers).toHaveBeenCalledTimes(1)
  })

  it('「開始条件を保存」で下書きをまとめて反映する', async () => {
    const { onClose } = await renderEditor()

    // 既存の友だち追加を外し、タグを1つ足す。
    fireEvent.click(screen.getAllByText('外す')[0])
    fireEvent.change(screen.getByLabelText('きっかけにするタグ'), { target: { value: 'tag-2' } })
    fireEvent.click(screen.getByText('＋ このタグが付いたとき'))
    expect(removeTrigger).not.toHaveBeenCalled()
    expect(addTrigger).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText('開始条件を保存'))
    })
    expect(onClose).toHaveBeenCalled()
    expect(removeTrigger).toHaveBeenCalledWith('sc-1', 'trig-1')
    expect(addTrigger).toHaveBeenCalledWith('sc-1', 'tag_added', 'tag-2')
    // 保存後に実態を読み直す。
    expect(listTriggers).toHaveBeenCalledTimes(2)
  })

  it('保存に失敗したら窓を閉じず、失敗を表示して実態へ合わせる', async () => {
    removeTrigger.mockResolvedValue({ success: false, error: '外せませんでした' })
    const { onClose } = await renderEditor()

    fireEvent.click(screen.getAllByText('外す')[0])
    await act(async () => {
      fireEvent.click(screen.getByText('開始条件を保存'))
    })

    expect(screen.getByText('外せませんでした')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // 部分反映を「保存済み」と見せないため、実態を読み直す。
    expect(listTriggers).toHaveBeenCalledTimes(2)
  })
})

describe('U005: 開始する友だちの条件は実データから作る', () => {
  it('条件が未設定なら未設定と表示し、一致人数は試算と同じ数を出す', async () => {
    await renderEditor({ audienceCondition: null })
    expect(screen.getByText('対象の絞り込みは未設定です。フォロー中の友だち全員が対象です。', { exact: false })).toBeTruthy()
    await screen.findByText('現在の条件に一致する友だち')
    expect(screen.getByText('10人')).toBeTruthy()
  })

  it('保存済みの条件から説明を作る。固定文は出さない', async () => {
    await renderEditor({
      audienceCondition: {
        operator: 'AND',
        rules: [
          { type: 'tag_exists', value: 'tag-1' },
          { type: 'ref_code', value: 'line' },
        ],
      },
    })
    expect(screen.getByText('対象の絞り込み：2 個の条件', { exact: false })).toBeTruthy()
    expect(screen.queryByText('流入経路「LINE公式」かつ タグ「初回案内未実施」')).toBeNull()
  })
})

describe('U006: 開始回数は固定仕様の説明にする', () => {
  it('選べない2択を置かず、実際の仕様を書く', async () => {
    await renderEditor()
    expect(screen.getByText('同じ友だちの開始回数')).toBeTruthy()
    expect(screen.queryByText('同じ友だちは初回のみ開始')).toBeNull()
    expect(screen.queryByText('条件を満たすたびに開始')).toBeNull()
    // 実挙動: status != 'completed' の重複だけを弾くので、読了後は再開する。
    expect(SOURCE).toContain('最後まで読み終えた人が条件を満たすと、もう一度最初から始まります')
  })
})

describe('U024/U025/U090: 固定レイアウトをやめる', () => {
  it('開始のきっかけは6列固定ではなく幅で折り返す', () => {
    // 前置きなしの grid-cols-6 は狭い幅でも6列になるので禁止。
    // xl: 以上なら画面幅に余裕があり、6列を許す。
    expect(SOURCE).not.toMatch(/(?<![:\w-])grid-cols-6/)
    expect(SOURCE).toContain('grid-cols-2')
    expect(SOURCE).toContain('sm:grid-cols-3')
  })

  it('560px固定のポップオーバーは無い。条件編集は本文内で行う', () => {
    expect(SOURCE).not.toContain('width: 560')
    expect(SOURCE).not.toContain('<details')
    expect(SOURCE).not.toContain('条件を編集')
  })

  it('932pxの最小高さを持たず、中身は画面高さに合わせてスクロールする', () => {
    expect(SOURCE).not.toContain('932')
    expect(SOURCE).toContain('maxHeight')
    expect(SOURCE).toContain('overflow-y-auto')
  })
})

describe('U088/U089: 共通アクセシブル部品と閉じる操作', () => {
  it('共通 Dialog を使う。dialog ロールと aria-modal を持つ', async () => {
    await renderEditor()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(SOURCE).toContain("from '@/components/shared/dialog'")
  })

  it('名前の無い × を置かず、「キャンセル」が閉じる操作になる', async () => {
    const { onClose } = await renderEditor()
    const unnamedClose = Array.from(document.querySelectorAll('button')).filter(
      (button) => (button.textContent ?? '').trim() === '×' && !button.getAttribute('aria-label'),
    )
    expect(unnamedClose).toHaveLength(0)
    fireEvent.click(screen.getByText('キャンセル'))
    expect(onClose).toHaveBeenCalled()
  })
})
