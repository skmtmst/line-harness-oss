import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * m22b：一覧の表の左右の余白と右端をそろえる。
 *
 * 点検 tools/audit/design-lint.mjs（k=3）は、表の枠から最初・最後の
 * 中身までの左右の余白を測る。右が12未満か、左右の差が12超で赤になる。
 * 原因は3つに分かれる。
 *
 * - 操作列の中身が左に残る → 共通の ActionCell で右へ寄せる。
 *   画面ごと `w-full justify-end` が無い行は足す。
 * - 文字だけのセルは枠で測られて0〜1pxになる → 中身を span で包み、
 *   本当の余白（セルの padding）で測らせる。見た目は変わらない。
 * - 列が器からはみ出す → 操作列を中身＋共通の余白24に広げる。
 *   読み上げ専用の表は測りから外す（大きさ0。読み上げは残る）。
 */

const WEB = path.join(__dirname, '..', '..')
const SRC = path.join(WEB, 'src')

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(SRC, ...segments), 'utf8')
}

describe('m22b 表の左右の余白（共通部品）', () => {
  it('操作列は右端にそろえる（共通 ActionCell）', () => {
    const css = read('components', 'shared', 'data-table.module.css')
    expect(css).toContain('text-align: right')
  })

  it('読み上げ専用の表は測りから外す（大きさ0）', () => {
    const css = read('components', 'shared', 'bar-chart.module.css')
    expect(css).toContain('width: 0')
    expect(css).toContain('height: 0')
  })
})

describe('m22b 表の左右の余白（操作列の右寄せ）', () => {
  it('/broadcasts：操作列は120px・共通の余白で右へ寄せる', () => {
    const body = read('app', 'broadcasts', 'page.tsx')
    expect(body).toContain("width: '16%'")
    expect(body).toContain('width: 120')
    expect(body).toContain(
      '<ActionCell className="sticky right-0 bg-canvas group-hover:bg-canvas-sunken">',
    )
  })

  it('/common-actions：操作の中身は枠いっぱいで右へ寄せる', () => {
    const body = read('app', 'common-actions', 'page.tsx')
    expect(body).toContain('relative flex w-full items-center justify-end gap-1.5')
  })

  it('/affiliate-offers（案件タブ）：操作は右端にそろえる', () => {
    const body = read('app', 'affiliates', 'tabs.tsx')
    expect(body).toContain('<Th align="right">操作</Th>')
    expect(body).toContain('px-4 py-3 text-right whitespace-nowrap')
  })

  it('/reminders：操作は右端にそろえる', () => {
    const body = read('app', 'reminders', 'page.tsx')
    expect(body).toContain('sticky right-0 w-44" align="right">操作')
    expect(body).toContain('sticky right-0 px-3 text-right')
    expect(body).toContain('relative flex w-full items-center justify-end gap-1')
  })

  it('/rich-menus：操作の中身は枠いっぱいで右へ寄せる', () => {
    const body = read('app', 'rich-menus', 'page.tsx')
    expect(body).toContain('relative flex w-full items-center justify-end gap-1.5')
  })

  it('/contents/vars：操作の中身は枠いっぱいで右へ寄せる', () => {
    const body = read('app', 'contents', 'vars', 'page.tsx')
    expect(body).toContain('flex w-full items-center justify-end gap-2')
  })

  it('/settings/file-scan：操作列は ActionCell＋固定幅で右へ寄せる', () => {
    const body = read('app', 'settings', 'file-scan', 'page.tsx')
    expect(body).toContain('ActionCell')
    expect(body).toContain('<Th align="right">操作</Th>')
  })

  it('/tags：操作列は中身＋共通の余白に広げる', () => {
    const body = read('components', 'friend-fields', 'tags-page-v4.tsx')
    expect(body).toContain('<Th style={{ width: 128 }} className="sticky right-0')
  })
})

describe('m22b 表の左右の余白（文字だけのセルを包む）', () => {
  it('/：日付と数字を包み、余白で測らせる', () => {
    const body = read('components', 'dashboard', 'friend-trend-table.tsx')
    expect(body).toContain('<span>{diff === null')
    expect(body).toContain('<span>{formatNumber(row.active')
  })

  it('/booking/menus：行頭の名前を包む', () => {
    const body = read('app', 'booking', 'menus', 'page.tsx')
    expect(body).toContain('<span>{m.name}')
  })

  it('/duplicates：先頭の文字を包む', () => {
    const body = read('app', 'duplicates', 'page.tsx')
    expect(body).toContain('<span className="block truncate">{candidate.left.label}')
    expect(body).toContain('<span className="block truncate">{row.accountName}</span>')
  })

  it('/friends/migrations：日付を包む', () => {
    const body = read('app', 'friends', 'migrations', 'page.tsx')
    expect(body).toContain('<span className="block">{formatDateTime(job.created_at)')
  })

  it('/friends/identity-candidates：採用する値を包む', () => {
    const body = read('app', 'friends', 'identity-candidates', 'page.tsx')
    expect(body).toContain('<Td className="pr-5"><span>判定時に選択</span></Td>')
  })
})
