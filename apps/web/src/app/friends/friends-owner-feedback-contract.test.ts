import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const DETAIL = readFileSync(join(__dirname, 'detail', 'page.tsx'), 'utf8')
const TABLE = readFileSync(join(__dirname, '..', '..', 'components', 'friends', 'friend-list-table.tsx'), 'utf8')
const DUPLICATES = readFileSync(join(__dirname, '..', 'duplicates', 'page.tsx'), 'utf8')
const USERS = readFileSync(join(__dirname, '..', 'users', 'page.tsx'), 'utf8')
const USER_FILTERS = readFileSync(join(__dirname, '..', '..', 'components', 'users', 'users-filters.tsx'), 'utf8')

describe('友だち画面のオーナー指摘契約', () => {
  it('一覧を行数に合わせ、表の下に固定の空白を残さない', () => {
    expect(TABLE).not.toContain('min-h-155')
    expect(TABLE).not.toContain('min-h-77.5')
    expect(TABLE).not.toContain('min-h-0 flex-1')
    expect(TABLE).toContain('px-6 py-10')
  })

  it('未対応と注目のみを小さな押し口にし、選択中はチェックで示す', () => {
    expect(PAGE).toContain('data-filter-chip="unhandled"')
    expect(PAGE).toContain('data-filter-chip="attention"')
    expect(PAGE).toContain('inline-flex h-8 shrink-0')
    expect(PAGE).toContain("responseFilter === 'unhandled'\n              ? <Check")
    expect(PAGE).toContain("attentionOnly\n              ? <Check")
  })

  it('友だち詳細のマイル残高を利用可能ラベルと同じ枠の一行に置く', () => {
    expect(DETAIL).toContain('mt-2 flex items-center justify-between rounded-control')
    expect(DETAIL).toContain('text-base font-bold tabular-nums')
    expect(DETAIL).not.toContain('text-2xl font-bold tabular-nums')
  })

  it('重複候補表の見出しを下の表と同じ縦余白にする', () => {
    expect(DUPLICATES.match(/<Th className="py-3">/g)).toHaveLength(7)
  })

  it('統合ユーザーの操作行を一重の枠と同じ高さにそろえる', () => {
    expect(USERS).toContain('data-design="V6UsersActions"')
    expect(USERS).toContain('items-center gap-2')
    expect(USERS).toContain('className="h-9 rounded-control border border-hairline')
    expect(USER_FILTERS).toContain('flex min-w-0 flex-1 flex-nowrap items-center gap-2')
    expect(USER_FILTERS).toContain('h-9 min-w-0 flex-1')
    expect(USER_FILTERS).not.toContain('rounded-[14px] border')
    expect(USER_FILTERS.match(/h-9/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
