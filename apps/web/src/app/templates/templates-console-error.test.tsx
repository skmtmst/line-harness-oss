// @vitest-environment happy-dom
/*
 * #615: `/templates` の初期表示で React の console error を出さない。
 *
 * ## なぜ実マウントなのか
 *
 * **「console error が出ていない」は、ソースの文字列検査では固定できない。**
 * 警告を出すのは React であって画面のコードではないので、実物を描いて
 * `console.error` を数えるしかない。happy-dom へ本物の `TemplatesPage` を
 * マウントし、一覧の行が出るまで待ってから、出た `console.error` を全部見る。
 *
 * **空振りで緑になるのを防ぐ。**読込中の枠だけ描いて早期に return していると、
 * 問題の入力欄がそもそも存在せず、何も見張らずに緑になる。数える前に
 * 「その入力欄が置かれていた道具帯」と「一覧の行」が実際に描かれたことを
 * 確かめる。
 *
 * この試験を直す前のコードへ当てると、狙いどおり1件だけ赤くなる。
 *
 *   You provided a `value` prop to a form field without an `onChange` handler.
 *
 * ## なぜ文字列の契約も要るのか
 *
 * **上のマウント試験だけだと、ごまかしで緑にできる。**`onChange={() => undefined}`
 * を足せば React は黙るが、ページ送りを持たない一覧に「20件表示」と出す嘘は
 * 残ったままになる。#513 L1（コンバージョン）が同じ形で禁じているので、
 * ここでも同じ2本立てにする。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

const TEMPLATES = [
  {
    id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
    messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
    usageCount: 3, updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
]

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: () => Promise.resolve({ success: false, error: '詳細は開かない' }),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

const consoleErrors: string[] = []
let restore: (() => void) | null = null

beforeEach(() => {
  consoleErrors.length = 0
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => String(arg)).join(' '))
  })
  restore = () => spy.mockRestore()
})

afterEach(() => {
  cleanup()
  restore?.()
  restore = null
})

describe('#615 テンプレート画面が React console error を出さない', () => {
  /*
    マウントはこの1回だけにする。React の警告には、同じ組み合わせを一度しか
    出さないものがある。同じファイルで2回描くと、2回目が黙るせいで
    「見張っているつもりで見ていない」になりかねない。
  */
  test('初期表示で console.error が1件も出ず、飾りの表示件数欄も無い', async () => {
    const { default: TemplatesPage } = await import('./page')
    render(<TemplatesPage />)

    /*
      空振り防止。問題の欄が置かれていた道具帯と、一覧の行が実際に出るまで待つ。

      待ち条件に `getBy*` を使わない。失敗するたびに DOM 全体を文字列へ
      起こした例外を作るので、この画面の大きさだと待つだけで20秒かかる。
      `queryBy*` は見つからなければ null を返すだけなので速い。
    */
    for (let attempt = 0; attempt < 200 && !screen.queryByText('来店お礼'); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
    expect(screen.queryByLabelText('名前・本文・差し込んでいる項目で検索')).toBeTruthy()
    expect(screen.queryByText('来店お礼')).toBeTruthy()

    expect(consoleErrors).toEqual([])
    // 押せる部品として残っていないこと（DOM で見る）。
    expect(screen.queryByRole('combobox', { name: '表示件数' })).toBeNull()
  }, 30_000)

  /*
    #513 L1（コンバージョン）と同じ禁止。マウント試験は
    `onChange={() => undefined}` を足すだけで緑に戻せるので、
    そのごまかしをここで止める。
  */
  test('飾りの表示件数切り替えを置かない（ごまかしの onChange も禁止）', () => {
    expect(PAGE).not.toContain('aria-label="表示件数"')
    expect(PAGE).not.toContain('onChange={() => undefined}')
    expect(PAGE).not.toContain('onChange={() => {}}')
  })
})
