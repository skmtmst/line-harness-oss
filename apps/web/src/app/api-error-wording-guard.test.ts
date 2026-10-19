import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「API error: 500」を画面に出さない見張り（リリース前点検 2026-10-07）。
 *
 * `ApiError` の message は、403・5xx などでは `API error: 500` という内部の文になる
 * （`lib/api.ts`）。`caught instanceof Error ? caught.message : '…'` のように message を
 * そのまま画面へ出すと、運用者に英語と番号だけが見える。画面に出すときは
 * `japaneseDetailOf(err) || '…'`（`components/shared/api-error-message`）か
 * `describeSaveFailure(err)`（`lib/api`）に寄せる。
 *
 * 持ち越しは BASELINE に「ファイル → 箇所の数」で残し、増えたら落とす（新しく混ぜない）。
 * 直したら数を減らすか行を消す——残っている限り、ここが「まだ直っていない画面」の一覧になる。
 * `API error` を同じ行で弾いている形（`!/^API error: /.test(...)`）は数えない。
 */

const SRC = path.join(__dirname, '..')

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** message をそのまま画面の文にしている形。 */
export const RAW_MESSAGE = /instanceof (?:Api)?Error(?: \|\| \w+ instanceof (?:Api)?Error)?(?: && \w+\.message)? \? \w+\.message\b|&& \w+\.message\) return \w+\.message/

export function countRawMessageLines(source: string): number {
  return code(source).split('\n').filter((line) => RAW_MESSAGE.test(line) && !line.includes('API error')).length
}

function collect(dir: string, found: Record<string, number> = {}): Record<string, number> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'generated') continue
      collect(full, found)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      const n = countRawMessageLines(fs.readFileSync(full, 'utf8'))
      if (n > 0) found[path.relative(SRC, full)] = n
    }
  }
  return found
}

/* 2026-10-07 時点の持ち越し（173 ファイル・304 か所）。直したら数を減らす。 */
const BASELINE: Record<string, number> = {
  'app/analytics/page.tsx': 1,
  'app/analytics/reports/new/page.tsx': 1,
  'app/auto-replies/edit/page.tsx': 1,
  'app/booking/menus/staff/page.tsx': 1,
  'app/booking/staff/staff-edit-dialog.tsx': 1,
  'app/chats/page.tsx': 1,
  'v8/automations/common-action-edit.tsx': 1,
  'app/hq/banners/project/page.tsx': 6,
  'app/hq/templates/template-definition-editor.tsx': 3,
  'app/login/two-factor/setup/page.tsx': 1,
  'v8/login/two-factor/two-factor-error.ts': 1,
  'app/mileage/earning-rules/edit/v8-earning-rule-edit.tsx': 1,
  'app/mileage/page.tsx': 2,
  'v8/nen-campaigns/column-intros.tsx': 1,
  'app/reminders/new/page.tsx': 1,
  'app/scenarios/first-step/page.tsx': 1,
  'app/staff/email-change/page.tsx': 1,
  'app/staff/invite/page.tsx': 1,
  'app/tags/fields/edit/page.tsx': 2,
  'app/tags/fields/migrate/page.tsx': 3,
  'app/tags/searches/edit/page.tsx': 3,
  'app/templates/page.tsx': 1,
  'app/updates/page.tsx': 1,
  'app/webhooks/webhook-runtime.spec.ts': 1,
  'v8/events/edit-form.tsx': 5,
  'components/friend-fields/tag-csv-import-dialog.tsx': 2,
  'components/friends/advanced-search-dialog.tsx': 1,
  'components/hq/banners/upload-button.tsx': 1,
  'components/hq/banners/upload-target-dialog.tsx': 1,
  'components/ops/ops-ui.tsx': 1,
  'components/rich-menus/apply-to-tag-modal.tsx': 1,
  'components/scenarios/duplicate-scenario.ts': 2,
  'components/scenarios/scenario-dialogs.tsx': 1,
  'components/step-up-prompt.tsx': 1,
  'components/update/update-button.tsx': 1,
  'components/webinars/webinar-error-text.ts': 1,
  'v8/affiliate-offer-new/create.tsx': 1,
  'v8/affiliates/approvals.tsx': 2,
  'v8/affiliates/create.tsx': 1,
  'v8/affiliates/drawer.tsx': 1,
  'v8/affiliates/offer-form.tsx': 1,
  'v8/affiliates/payment-dialogs.tsx': 2,
  'v8/affiliates/payment.tsx': 2,
  'v8/affiliates/report.tsx': 1,
  'v8/analytics/cross.tsx': 2,
  'v8/analytics/funnel.tsx': 2,
  'v8/analytics/saved.tsx': 4,
  'v8/auto-replies/quick-create.tsx': 1,
  'v8/automations/common-action-new.tsx': 1,
  'v8/automations/common-actions.tsx': 2,
  'v8/automations/runs.tsx': 2,
  'v8/automations/versions.tsx': 1,
  'v8/booking-menus/assign.tsx': 1,
  'v8/booking-menus/menu-form.tsx': 1,
  'v8/booking-menus/staff-edit-dialog.tsx': 1,
  'v8/broadcasts/quick-send.tsx': 1,
  'v8/contents/list.tsx': 2,
  'v8/contents/media-detail-dialog.tsx': 2,
  'v8/contents/media-replacement-dialog.tsx': 1,
  'v8/conversions/list.tsx': 2,
  'v8/events/create.tsx': 1,
  'v8/hq-banners/dialogs.tsx': 1,
  'v8/hq-banners/project.tsx': 5,
  'v8/hq-templates/console.tsx': 1,
  'v8/hq-templates/definition.ts': 1,
  'v8/hq-templates/message-form.tsx': 1,
  'v8/hq/home.tsx': 2,
  'v8/inflow-links/site-script.tsx': 3,
  'v8/line-notifications/operator-edit.tsx': 1,
  'v8/login/two-factor-ops.tsx': 1,
  'v8/mileage/adjust-dialog.tsx': 1,
  'v8/mileage/balances.tsx': 1,
  'v8/mileage/earning-rule-new/create.tsx': 2,
  'v8/mileage/earning-rules.tsx': 1,
  'v8/mileage/friend-detail.tsx': 2,
  'v8/mileage/history.tsx': 1,
  'v8/nen-posts/detail.tsx': 1,
  'v8/nen-posts/review.tsx': 1,
  'v8/restaurant/booking-kit/shell.tsx': 1,
  'v8/restaurant/close-tasks/close-tasks.tsx': 1,
  'v8/restaurant/closures/closure-dialog.tsx': 1,
  'v8/restaurant/common-a/frame.tsx': 1,
  'v8/restaurant/front-desk/phone-drawer.tsx': 1,
  'v8/restaurant/front-desk/walk-in-dialog.tsx': 1,
  'v8/restaurant/inventory/channels.tsx': 1,
  'v8/restaurant/store-new/store-new.tsx': 3,
  'v8/scenario-first-step/first-step.tsx': 1,
  'v8/scenarios/list.tsx': 1,
  'v8/settings/staff/staff.tsx': 1,
  'v8/tag-edit/edit.tsx': 1,
  'v8/tag-edit/search-edit.tsx': 3,
  'v8/tags/create.tsx': 1,
  'v8/tags/field-edit.tsx': 2,
  'v8/tags/field-migrate.tsx': 3,
  'v8/tags/use-fields-tab.tsx': 1,
  'v8/tags/searches-tab.tsx': 2,
  'v8/tags/tags-tab.tsx': 4,
  'v8/templates/carousel-core.ts': 1,
  'v8/webinar-edit/comments.tsx': 1,
}

describe('「API error: 500」を画面に出さない', () => {
  it('見張りの形が、そのまま出す書き方を拾い、弾いている書き方は拾わない', () => {
    expect(countRawMessageLines("setError(caught instanceof Error ? caught.message : '保存できませんでした')")).toBe(1)
    expect(countRawMessageLines("if (error instanceof ApiError && error.message) return error.message")).toBe(1)
    expect(countRawMessageLines("return caught instanceof ApiError && caught.message && !/^API error: /.test(caught.message) ? caught.message : fb")).toBe(0)
    expect(countRawMessageLines("return japaneseDetailOf(caught) || '保存できませんでした'")).toBe(0)
  })

  it('message をそのまま画面に出す箇所を増やさない（japaneseDetailOf・describeSaveFailure に寄せる）', () => {
    const found = collect(SRC)
    const grown = Object.entries(found)
      .filter(([file, n]) => n > (BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n}（持ち越し ${BASELINE[file] ?? 0}）`)
    expect(grown, '「API error: 500」が画面に出ます。japaneseDetailOf(err) || 案内文 に寄せてください').toEqual([])
  })

  it('点検で見つけた8か所は直したまま', () => {
    for (const file of [
      'v8/restaurant/google/format.ts',
      'v8/friends/migrations/use-uid-migration.ts',
      'app/accounts/use-uid-migration.ts',
      'v8/hq-broadcasts/create.tsx',
      'v8/hq-broadcasts/detail.tsx',
    ]) {
      expect(BASELINE[file] ?? 0, file).toBe(0)
    }
    const closures = fs.readFileSync(path.join(SRC, 'v8/restaurant/closures/closures.tsx'), 'utf8')
    expect(countRawMessageLines(closures)).toBe(0)
  })
})
