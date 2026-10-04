import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 禁止文言の全画面ガード（要件 v6-34 §10・§16）。
 *
 * 画面に出す字で「取得できません」を使わない。読めなかった失敗は
 * 対応表の文面と追跡番号で言う（§9）。
 *
 * 既存の持ち越しは KNOWN_FILES に残し、新規の混入だけをここで止める。
 * 直した画面は KNOWN_FILES から外す——残っている限り、この試験が
 * 「まだ直っていない画面」の一覧になる。
 */

const SRC = path.join(__dirname, '..')

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function collect(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      collect(full, found)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      const source = fs.readFileSync(full, 'utf8')
      if (code(source).includes('取得できません')) found.push(path.relative(SRC, full))
    }
  }
  return found
}

/*
 * 「取得できません」が残っている画面。直したらここから外す。
 * ここに載っている = 未修正ということがこの試験で分かるようにする。
 */
const KNOWN_FILES: string[] = [
  'app/accounts/new/page.tsx',
  'app/affiliates/affiliate-display.ts',
  'app/affiliates/tabs.tsx',
  'app/auto-replies/page.tsx',
  'app/booking/menus/new/page.tsx',
  'app/booking/menus/page.tsx',
  'app/emergency/page.tsx',
  'app/events/bookings/page.tsx',
  'app/events/edit/page.tsx',
  'app/events/page.tsx',
  'app/form-submissions/responses/page.tsx',
  'app/form-submissions/responses/response-summary.ts',
  'app/friend-add-settings/runs/page.tsx',
  'app/friends/detail/page.tsx',
  'app/getting-started/getting-started-view.ts',
  'app/health/page.tsx',
  'app/inflow-links/ad-integration.tsx',
  'app/inflow-links/detail/page.tsx',
  'app/inflow-links/page.tsx',
  'app/line-notifications/page.tsx',
  'app/mileage/mileage-history-tab.tsx',
  'app/nen-campaigns/nen-overview.tsx',
  'app/reminders/detail/page.tsx',
  'app/restaurant-test/google/google-business.tsx',
  'app/restaurant-test/google/google-profile.tsx',
  'app/rich-menus/edit/page.tsx',
  // page.tsx から分けた取り込み画面へ、v7 の持ち越し文が移った分。
  'app/rich-menus/external-import.tsx',
  'app/rich-menus/page.tsx',
  'app/scenarios/detail/scenario-detail-client.tsx',
  // 2026-10-04 完全切り替え：v7 page を捨て、V8 の list-v8 にしたので外す。
  'app/scenarios/results/page.tsx',
  // ★V8 版も同じ持ち越し文言を使う（直すときは page.tsx と一緒に直す）
  'app/settings/feature-settings-v8.tsx',
  'app/settings/page.tsx',
  'app/staff/page.tsx',
  'app/tags/fields/edit/page.tsx',
  'app/tags/searches/edit/page.tsx',
  'app/updates/page.tsx',
  'app/webhooks/webhook-overviews.tsx',
  'app/webinars/edit/page.tsx',
  'app/webinars/edit/review-text.ts',
  'components/chats/friend-info-sidebar.tsx',
  'components/friend-fields/field-list.tsx',
  'components/inflow-links/site-script.tsx',
  'components/line-notifications/notification-run-list.tsx',
  'components/scenarios/scenario-dialogs.tsx',
  'components/shared/list-kpis.tsx',
  'components/staff/login-audit.tsx',
  'lib/operation-status.ts',
]

describe('禁止文言「取得できません」', () => {
  it('KNOWN_FILES 以外に持ち込まない', () => {
    const known = new Set(KNOWN_FILES)
    const offenders = collect(SRC)
    const newlyIntroduced = offenders.filter((file) => !known.has(file))
    expect(
      newlyIntroduced,
      `新たに「取得できません」が入った: ${newlyIntroduced.join(', ')}。`
      + '対応表の文面と追跡番号で言ってください（要件 v6-34 §9-10）。',
    ).toEqual([])
  })

  it('直した画面は KNOWN_FILES から外す（一覧が残りの修正対象になる）', () => {
    const offenders = new Set(collect(SRC))
    const stale = KNOWN_FILES.filter((file) => !offenders.has(file))
    expect(
      stale,
      `もう直っているのに KNOWN_FILES に残っている: ${stale.join(', ')}。一覧から外してください。`,
    ).toEqual([])
  })
})
