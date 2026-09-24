import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

const TARGETS = [
  'affiliates/tabs.tsx',
  'booking/menus/page.tsx',
  'broadcasts/page.tsx',
  'form-submissions/page.tsx',
  'friend-add-settings/publish/page.tsx',
  'friends/page.tsx',
  'line-notifications/page.tsx',
  'line-notifications/operator-notification-rules.tsx',
  'mileage/action-score-tab.tsx',
  'mileage/page.tsx',
  'nen-members/page.tsx',
  'rich-menus/connections/page.tsx',
  'scenarios/page.tsx',
  'scenarios/results/page.tsx',
  'tags/marks/edit/page.tsx',
  '../components/broadcasts/segment-preset-controls.tsx',
  '../components/friend-fields/field-list.tsx',
  '../components/friend-fields/mark-list.tsx',
  '../components/friend-fields/tags-page-v4.tsx',
  '../components/friends/bulk-run-dialog.tsx',
  '../components/merged-person/merged-person-detail.tsx',
  '../components/users/users-table.tsx',
] as const

function failureDisplays(source: string) {
  // 取得失敗の面は ListState か ★V7 TargetMissing のどちらか。どちらも
  // 再読み込み口（onRetry）を持ち、古い個別ボタン（action）は持たない。
  const tags = [
    ...source.matchAll(/<ListState\b[\s\S]*?\/>/g),
    ...source.matchAll(/<TargetMissing\b[\s\S]*?\/>/g),
  ].map(([tag]) => tag)
  return tags.filter((tag) => tag.includes('kind="error"'))
}

describe('一覧の取得失敗からその場で読み直せる契約', () => {
  it('対象画面の取得失敗には、共通の再読み込み口を渡す', () => {
    let errorCount = 0

    for (const target of TARGETS) {
      const source = readFileSync(join(HERE, target), 'utf8')
      const errors = failureDisplays(source)
      errorCount += errors.length

      for (const errorState of errors) {
        expect(errorState, `${target} の取得失敗`).toContain('onRetry=')
        expect(errorState, `${target} に古い個別ボタンが残っています`).not.toContain('action=')
      }
    }

    // 友だち一覧の状態表示を FriendListTable へ集約した後の実測値。
    // #543: 回答フォーム一覧の到達不能な回答表（M2削除）にあった失敗表示ぶん1減。
    // #1014: 項目・対応マーク・タグの一覧に、取得失敗とは別の
    //        読み込み直し口（ListState kind="error" + onRetry）を足して3増。
    // SCENARIO-10: シナリオ結果の購読一覧に、取得失敗専用の再読み込み口を足して1増。
    // NOTIFY-04: どこからも使われていない古い運用者一覧（名前がリンクでない
    //        置き忘れの写し）を消したぶん1減。生きている一覧は
    //        app/line-notifications/operator-notification-rules.tsx。
    // #634: 一斉配信の失敗表示へ再読み込み口を足し（1増）、既に onRetry を
    //        持っていた LINE通知の2画面も契約の対象へ加えた（2増）。
    // V7 TargetMissing: 追加設定の公開・つながり・シナリオ結果の本体の
    //        失敗表示を TargetMissing の error へ寄せた。面の数は変わらない。
    expect(errorCount).toBe(27)
  })

  it('URLだけでは対象を特定できない状態に、直らない再読み込みを出さない', () => {
    const markEdit = readFileSync(join(HERE, 'tags/marks/edit/page.tsx'), 'utf8')
    const connections = readFileSync(join(HERE, 'rich-menus/connections/page.tsx'), 'utf8')

    expect(markEdit).toContain('編集する対応マークが指定されていません')
    expect(markEdit).toContain('if (!id)')
    // 対象未指定は ★V7 TargetMissing の unspecified（一覧へ戻るだけ）。
    expect(connections).toContain('kind="unspecified"')
    expect(connections).toContain('つながりを見るメニューが指定されていません')
    expect(connections).toContain('backHref="/rich-menus"')
  })
})
