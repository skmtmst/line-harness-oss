import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const APP = path.join(__dirname, '..', '..', 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * **画面名は上部バーだけが持つ。**
 *
 * 設計（Pencil）の本文に画面名テキストは無い。上部バー `cBSCb` が
 * h=56・20px・700 で1つだけ出す。本文の `<Header title=...>` は 30px の
 * 見出しをもう1つ描くので、同じ名前が2回出る。運用者から見ると
 * 「どちらが今いる画面なのか」が分からなくなる。
 *
 * 画面ごとに名前を変えたいときは `usePageTitle` で上部バーへ渡す。
 *
 * 下の一覧は**まだ直していないファイル**。多くは説明文や操作を一緒に
 * 持っていて、外すと情報が落ちるので順に移す。**増やさないこと。**
 * 直したら一覧から消す。空にできたら `<Header title=` を全面禁止にする。
 */
/*
 * `restaurant-test/terms` はサーバー側で描くので `usePageTitle`
 * （クライアントの hook）を呼べない。ビルドが
 * 「Attempted to call usePageTitle() from the server」で落ちる。
 * サーバー側の画面は別の渡し方が要るので、ここに残してある。
 */
const NOT_YET_MIGRATED = [
  'auto-replies/edit/page.tsx',
  'auto-replies/page.tsx',
  'automations/page.tsx',
  'booking/bookings/detail/page.tsx',
  'booking/bookings/page.tsx',
  'booking/menus/staff/page.tsx',
  'booking/staff/page.tsx',
  'booking/staff/shifts/page.tsx',
  'broadcasts/detail/page.tsx',
  'broadcasts/new/page.tsx',
  'broadcasts/page.tsx',
  'duplicates/page.tsx',
  'ec-commerce/page.tsx',
  'events/bookings/page.tsx',
  'events/edit/page.tsx',
  'events/page.tsx',
  'form-submissions/edit/page.tsx',
  'friends/detail/page.tsx',
  'inflow-links/detail/page.tsx',
  'inflow-links/page.tsx',
  'nen-campaigns/edit/campaign-editor.tsx',
  'nen-campaigns/edit/page.tsx',
  'nen-campaigns/page.tsx',
  'notifications/page.tsx',
  'reminders/edit/page.tsx',
  'reminders/page.tsx',
  'restaurant-test/restaurant-console.tsx',
  'restaurant-test/terms/page.tsx',
  'scenarios/detail/scenario-detail-client.tsx',
  'scenarios/first-step/page.tsx',
  'scenarios/mode/page.tsx',
  'scenarios/page.tsx',
  'staff/page.tsx',
  'tags/edit/page.tsx',
  'tags/page.tsx',
  'templates/carousel/page.tsx',
  'templates/detail/page.tsx',
  'templates/edit/page.tsx',
  'users/page.tsx',
  'webhooks/page.tsx',
  'webinars/edit/page.tsx',
  'webinars/new/page.tsx',
  'webinars/page.tsx',
]

describe('画面名は上部バーだけが持つ', () => {
  it('本文に画面名を出すファイルを増やさない', () => {
    const offenders = walk(APP)
      .filter((f) => /<Header\s+title=/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(APP, f))
      .sort()
    const unexpected = offenders.filter((f) => !NOT_YET_MIGRATED.includes(f))
    expect(unexpected, '本文に画面名を出す新しいファイルが増えた').toEqual([])
  })

  it('上部バーへ名前を渡した画面が、本文の見出しへ戻っていない', () => {
    // 本文の単独見出しを外し `usePageTitle` へ移した画面。
    const moved = [
      'broadcasts/detail/page.tsx',
      'webinars/edit/page.tsx',
      'health/page.tsx',
      'nen-campaigns/edit/campaign-editor.tsx',
      'templates/detail/page.tsx',
      'scenarios/detail/scenario-detail-client.tsx',
      'events/edit/page.tsx',
      'events/new/page.tsx',
      'form-submissions/edit/page.tsx',
      'pools/page.tsx',
      'hq/settings/page.tsx',
      'rich-menus/edit/page.tsx',
      'rich-menus/new/page.tsx',
      'search-console/page.tsx',
      'restaurant-test/stores/new/page.tsx',
    ]
    for (const rel of moved) {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      expect(src, rel + ' が上部バーへ名前を渡していない').toContain('usePageTitle(')
    }
  })

  it('直した画面から単独の見出しが消えている', () => {
    // `<Header title="..." />` だけの行（説明も操作も持たない二重見出し）。
    const cleaned: Array<[string, string]> = [
      ['health/page.tsx', 'BAN検知ダッシュボード'],
      ['templates/detail/page.tsx', 'テンプレートの詳細'],
      ['nen-campaigns/edit/campaign-editor.tsx', 'NEN配信を編集する'],
      ['scenarios/detail/scenario-detail-client.tsx', 'シナリオ詳細'],
      ['webinars/edit/page.tsx', 'ウェビナー編集'],
    ]
    for (const [rel, title] of cleaned) {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      expect(src, rel + ' に単独の二重見出しが戻っている').not.toContain(
        '<Header title="' + title + '" />',
      )
    }
  })
})
