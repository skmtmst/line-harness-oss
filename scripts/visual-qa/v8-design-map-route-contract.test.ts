/*
 * 監査 ROOT-19：板と画面の対応表で、分類の行（1行に分類の画面の場所を全部並べた行）の板が
 * いちばん前の /notifications へ寄せられ、LINEアカウントの一覧・詳細などを関係ない
 * 「通知」の画面と比べていた。分類の行の板は、板ごとの正しい場所で開く。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import designMap from './v8-design-map.json'
// @ts-expect-error 表を作る道具は素のJSで型定義を持たない。
import { entryOf } from './build-v8-board-to-code.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

type Board = { name: string; route: string | null; url?: string | null; routes?: string[] }
const BOARDS = (designMap as { boards: Record<string, Board> }).boards

describe('板と画面の対応表の場所', () => {
  it('LINEアカウントの一覧（V7vn3）・詳細（ihjfd）は通知の画面ではなく、その画面で開く', () => {
    expect(BOARDS.V7vn3.url).toBe('/accounts')
    expect(BOARDS.ihjfd.route).toBe('/accounts/detail')
    expect(BOARDS.ihjfd.url).toMatch(/^\/accounts\/detail\?id=/)
  })

  it('分類の行の板は、代表（いちばん前）へ寄せず、板ごとの場所を持つ', () => {
    const categoryBoards = Object.entries(BOARDS).filter(([, board]) => (board.routes ?? []).length >= 4)
    expect(categoryBoards.length).toBeGreaterThan(0)
    const onNotifications = categoryBoards
      .filter(([, board]) => board.url === '/notifications' && !board.name.startsWith('通知'))
      .map(([id, board]) => `${id} ${board.name}`)
    expect(onNotifications).toEqual([])
    for (const [, board] of categoryBoards) {
      if (board.url == null) continue
      expect(board.route).toBe(board.url.split('?')[0])
    }
  })

  it('統括のバナー生成の板は /hq ではなく、バナーの画面（一覧・プロジェクトの中）で開く', () => {
    for (const id of ['B9ZAr', 'W5Wxr', 'iMnph', 'rI5uh', 'B24oNg', 'I0w2e']) {
      expect(BOARDS[id].route?.startsWith('/hq/banners')).toBe(true)
    }
  })
})

describe('板と画面のコードの表（docs/v8-board-to-code.md）', () => {
  const rows = readFileSync(join(ROOT, 'docs/v8-board-to-code.md'), 'utf8')
    .split('\n')
    .filter((line) => /^\| V8(?:-B)? \|/.test(line))
    .map((line) => line.slice(1, -1).split(' | ').map((part) => part.trim()))

  it('指定つきの URL（?id= など）でも、入口があれば「page.tsx なし」にしない', () => {
    const wrong = rows
      .filter(([, , , url, entry]) => url !== '—' && entry === '（page.tsx なし）' && (entryOf(url) as string | null) !== null)
      .map(([, id, , url]) => `${id} ${url}`)
    expect(wrong).toEqual([])
  })

  it('共通の見出し（readonly-header-v8）を画面のファイルとして載せない。LINEアカウントは実際に描く画面', () => {
    expect(rows.filter(([, , , , , files]) => /readonly-header-v8/.test(files ?? '')).map(([, id]) => id)).toEqual([])
    expect(rows.find(([, id]) => id === 'V7vn3')?.[5]).toBe('`v8/settings/accounts/accounts.tsx`')
  })
})
