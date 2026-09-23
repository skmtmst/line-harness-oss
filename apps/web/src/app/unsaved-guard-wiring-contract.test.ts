import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * DETAIL-04系（画面によって未保存の離脱警告が出る／出ない）の再発防止。
 *
 * 「未保存の編集状態」を持つ画面は、離脱の番兵を共通フック
 * `useUnsavedGuard`（+ ConfirmDialog）で持つことを機械的に確認する。
 * 新しい編集画面を足したら、GUARDED か COVERED_BY_PARENT か
 * EXEMPTIONS（理由つき）へ分類を追加する。未分類のままだとこのテストが落ちる。
 */

/** 未保存の編集状態を持つ画面の印。dirty系の名前・スナップショット・未保存の文言。 */
const DIRTY_SIGNATURE = /dirty|unsaved|savedSnapshot|未保存/i

/** 番兵を持つ画面。`useUnsavedGuard` と離脱確認ダイアログの両方が必要。 */
const GUARDED = [
  'app/booking/menus/staff/page.tsx',
  'app/contents/vars/edit/page.tsx',
  'app/contents/vars/new/page.tsx',
  'app/ec-commerce/connector-panel.tsx',
  'app/form-submissions/edit/page.tsx',
  'app/friend-add-settings/friend-add-rule-editor.tsx',
  'app/mileage/page.tsx',
  'app/nen-campaigns/columns/new/page.tsx',
  'app/nen-campaigns/edit/campaign-editor.tsx',
  'app/nen-campaigns/edit/page.tsx',
  'app/nen-campaigns/page.tsx',
  'app/nen/members/lifetime-tab.tsx',
  'app/nen/members/rank-settings-tab.tsx',
  'app/nen/pets/feeding-tab.tsx',
  'app/reminders/edit/issue469-reminder-screens.tsx',
  'app/reminders/new/page.tsx',
  'app/rich-menus/edit/page.tsx',
  'app/rich-menus/new/page.tsx',
  'app/settings/page.tsx',
  'app/tags/fields/new/page.tsx',
  'app/tags/searches/edit/page.tsx',
  'app/webinars/edit/page.tsx',
  'components/accounts/account-ordering.tsx',
] as const

/*
 * dirty を子（pane・部分部品）から親へ報告し、番兵は親が持つ画面。
 * 子は `onDirtyChange` 等で報告するだけで、自分では確認対話を出さない。
 */
const COVERED_BY_PARENT: Record<string, string> = {
  'components/webinars/webinar-form.tsx': 'app/webinars/edit/page.tsx',
  'components/webinars/webinar-notifications.tsx': 'app/webinars/edit/page.tsx',
}

/*
 * dirty はあるが、画面離脱の番兵を「今は」持たないもの。理由を必ず書く。
 * 番兵を付けられるようになったら EXEMPTIONS から GUARDED へ移す。
 */
const EXEMPTIONS: Record<string, string> = {
  'app/affiliates/new/page.tsx':
    '「未保存の追加情報を破棄して一覧へ戻る」明示フロー。dirty管理ではなく部分保存の案内',
  'app/automations/new/page.tsx':
    'サーバーへ下書き保存する多段ウィザード。段またぎ・店ごとの退避があり離脱の扱いは別途検討',
  'app/booking/bookings/new/page.tsx':
    'dirty管理なし（コメント中の「未保存」記述のみ）',
  'app/hq/templates/template-console.tsx':
    '多段ウィザード＋sessionStorage下書き。段の途中離脱の扱いは別途検討',
  'app/line-notifications/page.tsx':
    '入力を端末の下書きへ随時保存し、閉じる確認はエディタ内で済ませる設計。画面離脱への警告は要検討',
  'app/nen-campaigns/nen-overview.tsx':
    '紹介文の下書きは大きな一覧コンポーネント内のローカル状態。親の番兵へ載せるには報告口が要るため別途検討',
  'app/staff/page.tsx':
    '権限プレビューの「変更後の予定」。リンクは下書きを捨てて移る仕様として明示済み',
  'components/scenarios/trigger-editor.tsx':
    'ダイアログ内の dirty。閉じると元に戻る仕様で、画面離脱ガードの対象外',
  'components/shared/drawer.tsx':
    'dirty 印（*）を表示するだけの共通部品。編集画面ではない',
}

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* tsxFiles(path)
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      yield path
    }
  }
}

function dirtyTrackingFiles(): string[] {
  const found: string[] = []
  for (const root of ['app', 'components']) {
    for (const path of tsxFiles(join(SRC, root))) {
      if (DIRTY_SIGNATURE.test(readFileSync(path, 'utf8'))) {
        found.push(path.slice(SRC.length + 1))
      }
    }
  }
  return found.sort()
}

describe('未保存の編集がある画面は離脱の番兵を持つ契約（DETAIL-04系）', () => {
  it('dirty を持つ画面は「番兵あり／親が持つ／理由つき対象外」のどれかへ分類されている', () => {
    const classified = new Set([...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS)])
    const unclassified = dirtyTrackingFiles().filter((file) => !classified.has(file))
    expect(
      unclassified,
      '未保存の編集状態を持つ画面が未分類です。useUnsavedGuard を付けて GUARDED へ、' +
        'または理由を書いて EXEMPTIONS へ追加してください（unsaved-guard-wiring-contract.test.ts）',
    ).toEqual([])
  })

  it('番兵を持つ画面は共通フックと離脱確認ダイアログを配線している', () => {
    for (const file of GUARDED) {
      const source = readFileSync(join(SRC, file), 'utf8')
      expect(source, file).toContain('useUnsavedGuard(')
      expect(source, `${file} の離脱確認`).toContain('leaveTarget !== null')
    }
  })

  it('親へ dirty を報告する画面の親は、共通フックで番兵を持っている', () => {
    for (const [file, parent] of Object.entries(COVERED_BY_PARENT)) {
      const parentSource = readFileSync(join(SRC, parent), 'utf8')
      expect(parentSource, `${file} の番兵を持つ親 ${parent}`).toContain('useUnsavedGuard(')
    }
  })

  it('分類表に載せたファイルは実在し、対象外には理由がある', () => {
    for (const file of [...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS)]) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} が見つかりません`).not.toThrow()
    }
    for (const [file, reason] of Object.entries(EXEMPTIONS)) {
      expect(reason.length, `${file} の対象外理由`).toBeGreaterThan(0)
    }
  })
})
