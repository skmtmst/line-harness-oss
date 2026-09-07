import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const page = (path: string) => readFileSync(join(APP, path, 'page.tsx'), 'utf8')

const targets = [
  ['予約一覧', page('booking/bookings')],
  ['予約詳細', page('booking/bookings/detail')],
  ['メニュー担当', page('booking/menus/staff')],
  ['予約スタッフ', page('booking/staff')],
  ['イベント編集', page('events/edit')],
] as const

describe('Issue #450 本文上部の旧Headerを外す', () => {
  it.each(targets)('%s は本文に旧Headerを描かない', (_name, source) => {
    expect(source).not.toContain("@/components/layout/header")
    expect(source).not.toContain('<Header')
  })

  it('設計にある操作はパンくずの近くへ残す', () => {
    expect(targets[0][1]).toContain('電話の予約を入れる')
    expect(targets[2][1]).toContain('変更を保存')
    expect(targets[3][1]).toContain('+ 新規スタッフ')
    expect(targets[4][1]).toContain('申込の一覧を見る')
  })
})
