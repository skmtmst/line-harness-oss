import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

/**
 * 「準備中」を画面から無くすための、全画面ぶんの見張り。
 *
 * `docs/v6-common-rules.md` §7-10 は **「`準備中` のボタンが1つも無い（出す＝使える）」**
 * を完了の条件にしている。§2-2 は「使えないプルダウンを完成画面に置かない」、
 * §5-5 は「隠すのではなく、そもそも描かない」。
 *
 * これまでは画面ごとに `expect(PAGE).not.toContain('マニュアルは準備中です')` を
 * 書き足していた。**書いた画面しか見張れず、新しい画面には効かない。**
 * ここで 130 ページと共通部品を一度に見る形へ一般化する。
 *
 * ## 何を禁じるか
 *
 * 禁じるのは**言い訳の言い回し**（`準備中です` / `準備中）` / `準備中)`）。
 * 「まだ動きません」を吹き出しや注記で言い添えて、押せない操作を
 * 置いたままにする書き方がこれにあたる。
 *
 * **裸の `準備中` は禁じない。** イベントの状態（まだ公開していない）は
 * 設計そのものが `準備中` と呼んでいて、`src/lib/design-structure.json` の
 * `/events` にもその言葉が入っている。設計にある状態名まで消すと、
 * 実装が設計から離れる。ただし例外は `DESIGN_WORDS` に書いた場所だけで、
 * 数も固定する（言い回しを変えて言い訳を逃がさないため）。
 */

/** 画面のコードを、`.test.` を除いて集める。 */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

/**
 * 注釈を落とす。見張りたいのは**画面に出る言葉**だけ。
 *
 * 「なぜ準備中をやめたか」を書いた注釈が自分の見張りに当たると、
 * 直したのに落ちるという嘘の失敗になる。
 */
function visible(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FILES = sources(SRC).map((p) => ({
  p: path.relative(SRC, p).split(path.sep).join('/'),
  s: visible(fs.readFileSync(p, 'utf8')),
}))

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

/** 「まだ動きません」の言い訳。これを画面に置かない。 */
const EXCUSE = /準備中(?:です|[）)])/g

/** 「準備中」という言葉そのもの。 */
const ANY = /準備中/g

/**
 * 設計そのものにある状態名。**言い訳ではないので直さない。**
 *
 * イベントの `is_published !== 1`（まだ公開していない）を、設計は `準備中` と呼ぶ。
 */
const DESIGN_WORDS: Record<string, number> = {
  'app/events/page.tsx': 1,
}

/**
 * まだ残っている言い訳。**担当（S1〜S3）が機能ごとに消す。**
 *
 * ここは減る一方の表。
 * - 数を**増やせない**（新しい「準備中」を足せない）
 * - 0 になったら**行ごと消す**（消し忘れるとこの試験が落ちる）
 *
 * 共通部品（`components/shared`）はこの表に載せない。載せない＝0 件。
 *
 * 2026-09-03 時点で 33 ファイル・73 件。
 * 2026-09-04: 自動応答（`app/auto-replies/page.tsx`）の 2 件を外して 0 になったので行を消した。
 *   絞り込みの「30日以上の絞り込みは準備中」と、行き先の決まっていない「マニュアル」。
 */
const REMAINING: Record<string, number> = {
  'app/accounts/migration.tsx': 2,
  'app/booking/bookings/detail/page.tsx': 4,
  'app/booking/bookings/page.tsx': 5,
  'app/booking/menus/staff/page.tsx': 1,
  'app/booking/staff/new/page.tsx': 2,
  'app/booking/staff/shifts/page.tsx': 1,
  'app/broadcasts/detail/page.tsx': 2,
  'app/broadcasts/page.tsx': 3,
  'app/conversions/new/page.tsx': 1,
  'app/ec-commerce/page.tsx': 2,
  'app/events/bookings/page.tsx': 3,
  'app/events/page.tsx': 6,
  'app/form-submissions/edit/page.tsx': 1,
  'app/friends/detail/page.tsx': 1,
  'app/inflow-links/ad-integration.tsx': 2,
  'app/inflow-links/detail/page.tsx': 1,
  'app/inflow-links/page.tsx': 2,
  'app/reminders/page.tsx': 1,
  'app/restaurant-test/stores/new/page.tsx': 1,
  'app/scenarios/detail/scenario-detail-client.tsx': 1,
  'app/scenarios/first-step/page.tsx': 1,
  'app/scenarios/mode/page.tsx': 1,
  'app/scenarios/page.tsx': 1,
  'app/search-console/page.tsx': 3,
  'app/templates/carousel/page.tsx': 2,
  'app/templates/edit/page.tsx': 4,
  'app/webinars/page.tsx': 1,
  'components/broadcasts/broadcast-form.tsx': 7,
  'components/events/event-wizard.tsx': 2,
  'components/friends/bulk-run-dialog.tsx': 1,
  'components/friends/friend-timeline.tsx': 1,
  'components/inflow-links/site-script.tsx': 5,
}

describe('画面に「準備中」を置かない', () => {
  it('全画面を読めている（数え漏れの見張り）', () => {
    // 数え漏れ（読む場所を間違えて 0 件になる）だけを見張る。
    // ちょうどの枚数は画面が増えるたびに動くので、下限をゆるく取る。
    expect(FILES.length).toBeGreaterThan(300)
    expect(FILES.filter((f) => /^app\/.*\/page\.tsx$/.test(f.p) || f.p === 'app/page.tsx')).toHaveLength(131)  // 2026-09-04: 自動応答の公開（`auto-replies/publish`）が入って 131。
  })

  it('共通部品に「準備中」が1つも無い', () => {
    for (const f of FILES.filter((f) => f.p.startsWith('components/shared/'))) {
      expect(count(f.s, ANY), `${f.p} に「準備中」がある`).toBe(0)
    }
  })

  it('表に無いファイルは「準備中」を1つも持たない', () => {
    for (const f of FILES) {
      if (f.p in REMAINING || f.p in DESIGN_WORDS) continue
      expect(count(f.s, ANY), `${f.p} に新しい「準備中」が入った`).toBe(0)
    }
  })

  it('残りの表より「準備中」を増やさない', () => {
    for (const f of FILES) {
      const allowed = REMAINING[f.p]
      if (allowed === undefined) continue
      expect(count(f.s, EXCUSE), `${f.p} の「準備中」が ${allowed} 件から増えた`).toBeLessThanOrEqual(allowed)
    }
  })

  it('0 件になったファイルは表から消す', () => {
    for (const p of Object.keys(REMAINING)) {
      const f = FILES.find((x) => x.p === p)
      expect(f, `${p} が無い。表から消す`).toBeDefined()
      expect(count(f!.s, EXCUSE), `${p} は 0 件になった。表から行を消す`).toBeGreaterThan(0)
    }
  })

  it('言い回しを変えて言い訳を逃がさない', () => {
    for (const f of FILES) {
      const design = DESIGN_WORDS[f.p] ?? 0
      expect(count(f.s, ANY), `${f.p} に、言い訳でも設計の状態名でもない「準備中」がある`).toBe(
        count(f.s, EXCUSE) + design,
      )
    }
  })

  it('設計にある状態名だけは残す（イベントの未公開）', () => {
    const events = FILES.find((f) => f.p === 'app/events/page.tsx')!
    expect(count(events.s, ANY) - count(events.s, EXCUSE)).toBe(DESIGN_WORDS['app/events/page.tsx'])
    // 設計の書き出しにも同じ言葉がある（状態の列の値）。実装だけの言い訳ではない。
    const structure = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'design-structure.json'), 'utf8'))
    const parts: string[] = structure.screens['/events'].parts
    expect(parts).toContain('状態')
    expect(parts).toContain('準備中')
  })
})
