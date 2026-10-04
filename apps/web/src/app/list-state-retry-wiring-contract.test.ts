import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

const TARGETS = [
  'affiliates/tabs.tsx',
  'booking/menus/page.tsx',
  'broadcasts/page.tsx',
  'friend-add-settings/publish/page.tsx',
  '../components/friends/friend-list-table.tsx',
  'line-notifications/page.tsx',
  'line-notifications/operator-notification-rules.tsx',
  'mileage/action-score-tab.tsx',
  'mileage/page.tsx',
  'nen-members/photo-review-v8.tsx',
  'rich-menus/connections/page.tsx',
  // 失敗表示を持つ本体を指定し、別の詳細画面・ダイアログは取り込まない。
  'scenarios/results/page.tsx',
  'tags/mark-editor-v8.tsx',
  '../components/broadcasts/segment-preset-controls.tsx',
  '../components/friend-fields/field-list.tsx',
  '../components/friend-fields/mark-list.tsx',
  '../components/friend-fields/tags-page-v4.tsx',
  '../components/friends/bulk-run-dialog.tsx',
  '../components/merged-person/merged-person-detail.tsx',
  '../components/users/users-table.tsx',
] as const

function failureDisplays(source: string) {
  // 一覧・対象取得の本体だけを読み、共通の失敗表示の再読み込み口を確認する。
  const tags = [
    ...source.matchAll(/<ListState\b[\s\S]*?\/>/g),
    ...source.matchAll(/<TargetMissing\b[\s\S]*?\/>/g),
    ...source.matchAll(/<TableStateRow\b[\s\S]*?\/>/g),
  ].map(([tag]) => tag)
  return tags.filter((tag) => tag.includes('kind="error"'))
}

describe('一覧の取得失敗からその場で読み直せる契約', () => {
  it('対象画面の取得失敗には、共通の再読み込み口を渡す', () => {
    for (const target of TARGETS) {
      const source = readFileSync(join(HERE, target), 'utf8')
      const errors = failureDisplays(source)
      expect(errors.length, `${target} の取得失敗表示が検査から消えています`).toBeGreaterThan(0)

      for (const errorState of errors) {
        expect(errorState, `${target} の取得失敗`).toContain('onRetry=')
        expect(errorState, `${target} に古い個別ボタンが残っています`).not.toContain('action=')
      }
    }
  })

  it('V8の専用失敗表示も、その場で一覧を読み直せる', () => {
    for (const [target, message, retry] of [
      ['broadcasts/list-v8.tsx', '一斉配信を読み込めませんでした', 'onClick={() => void loadList((page - 1) * pageSize)}'],
      ['form-submissions/list-v8.tsx', '回答フォームを読み込めませんでした', 'onClick={() => void loadForms()}'],
      ['scenarios/list-v8.tsx', 'シナリオを読み込めませんでした', 'onClick={() => void loadScenarios()}'],
      ['reminders/list-v8.tsx', 'リマインダを読み込めませんでした', 'onClick={reminderList.retry}'],
    ]) {
      const source = readFileSync(join(HERE, target), 'utf8')
      const failureAt = source.lastIndexOf(message)
      expect(failureAt, `${target} の取得失敗表示`).toBeGreaterThan(-1)
      // 失敗表示の中で、押したら読み直すボタンにつながっていることを確認する。
      expect(source.slice(failureAt, failureAt + 1200), target).toContain(retry)
    }
    const forms = readFileSync(join(HERE, 'form-submissions/list-v8.tsx'), 'utf8')
    expect(forms).toContain('const forbidden = isForbidden(loadFailure)')
    expect(forms).toContain('{!forbidden ? (')
    const friends = readFileSync(join(HERE, 'friends/page.tsx'), 'utf8')
    expect(friends).toContain('onRetry={() => void loadFriends()}')
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
