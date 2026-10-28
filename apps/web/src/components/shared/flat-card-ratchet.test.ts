import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/*
 * 影の無いカード（線だけの箱・平らな地の箱）を増やさない。
 * カードは白い地に影だけ（決まり）。共通の Card を影の無い形（frame の flat・ring・inset、
 * surface の inset・bordered・muted）で使うファイルを探し、下の「直す途中」に無いファイルで出たら落とす。
 * 直し終えたファイルは一覧から外す（足さない）。カードそのものの形を影ありにそろえるのは Card の持ち主（tone）。
 */
const migrating = new Set([
  'app/analytics/reports/new/page.tsx',
  'components/accounts/account-ordering.tsx',
  'components/shared/condition-builder.tsx',
  'components/shared/recovery-code-list.tsx',
  'components/shared/reservation-board.tsx',
  'v8/account-new/register.tsx',
  'v8/account-new/step1-precheck.tsx',
  'v8/account-new/step2-connect.tsx',
  'v8/account-new/step4-template.tsx',
  'v8/account-new/step5-completion.tsx',
  'v8/accounts-detail/detail.tsx',
  'v8/accounts-detail/handover.tsx',
  'v8/affiliate-offer-new/create.tsx',
  'v8/automations/templates.tsx',
  'v8/booking-bookings/day-frame.tsx',
  'v8/booking-bookings/day-list.tsx',
  'v8/booking-menus/photos.tsx',
  'v8/contents/list-media-card.tsx',
  'v8/emergency/control.tsx',
  'v8/events/create.tsx',
  'v8/hq-banners/list.tsx',
  'v8/hq/home.tsx',
  'v8/login/recovery-codes.tsx',
  'v8/login/two-factor-ops.tsx',
  'v8/mileage/reward-edit.tsx',
  'v8/nen-pets/feeding.tsx',
  'v8/notifications/list.tsx',
  'v8/onboarding/style-choice-step.tsx',
  'v8/onboarding/wizard.tsx',
  'v8/restaurant-reservations/detail-dialog.tsx',
  'v8/restaurant/approvals/approvals.tsx',
  'v8/restaurant/booking-kit/shell.tsx',
  'v8/restaurant/inventory/stock.tsx',
  'v8/restaurant/organization/organization-forms.tsx',
  'v8/restaurant/reservations/list.tsx',
  'v8/rich-menus/connections.tsx',
  'v8/settings/emergency/security-monitor.tsx',
  'v8/settings/pools/create.tsx',
  'v8/settings/pools/pools.tsx',
  'v8/settings/staff/create.tsx',
  'v8/settings/staff/mfa-policy.tsx',
  'v8/tags/create.tsx',
  'v8/webhooks/create.tsx',
])

const FLAT = /<Card\b[^>]*?\b(?:frame="(?:flat|ring|inset)"|surface="(?:inset|bordered|muted)")/

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES: Array<{ p: string; s: string }> = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) FILES.push({ p: relative(SRC, p), s: readFileSync(p, 'utf8') })
  }
}
walk(SRC)

it('直す途中のファイルの外で、影の無いカードを使わない', () => {
  const hits = FILES.filter((f) => !migrating.has(f.p) && FLAT.test(f.s)).map((f) => f.p)
  expect(hits, '共通の Card を影ありの形（frame・surface を付けない）で使う').toEqual([])
})

it('影の無い形だけを拾う', () => {
  expect(FLAT.test('<Card frame="flat">a</Card>')).toBe(true)
  expect(FLAT.test('<Card surface="muted" padding="compact">b</Card>')).toBe(true)
  expect(FLAT.test('<Card variant="aside">b</Card>')).toBe(false)
})
