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
  'app/restaurant-test/google/google-business.tsx',
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

/*
 * V6R-S0-c: 「dirty を持たない編集画面」も網に入れる。
 *
 * 上の DIRTY_SIGNATURE は、変更の有無を名前や文言で持つ画面しか拾えない。
 * 変更の有無そのものを持たない編集画面（一斉配信の作成・テンプレート編集など）は、
 * 番兵が無くてもこの試験を通っていた。そこで「保存の口」と「入力欄3つ以上」を持つ
 * 画面を編集画面とみなし、分類を求める。
 */
const EDITOR_SAVE_SIGNATURE = /(?:\bapi(?:\.[A-Za-z]+)+|\b[a-z][A-Za-z]*Api)\.(?:create|update|save|patch|upsert)[A-Za-z]*\(/
const EDITOR_INPUT_SIGNATURE = /<(input|textarea|TextField|TextArea|SelectField)\b/g
const EDITOR_MIN_INPUTS = 3

/*
 * 編集画面の印はあるが、番兵が要るかをまだ決めていないもの（2026-09-23 時点の棚卸し）。
 * 担当レーンが「GUARDED へ移す」か「理由を書いて EXEMPTIONS へ移す」を決め、ここから消す。
 * **ここへの追加は禁止。** 新しい編集画面は最初から GUARDED か EXEMPTIONS に入れる。
 */
const UNTRIAGED: Record<string, string> = {
  'app/affiliate-offers/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/affiliates/action-dialogs.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/affiliates/tabs.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/analytics/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/analytics/reports/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/auto-replies/publish/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/bookings/detail/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/menus/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/menus/page.tsx':
    's3: 予約メニュー。同じ機能の staff は番兵あり。V6R-S3-b（board#1067）で付ける',
  'app/booking/staff/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/staff/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/staff/shifts/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/broadcasts/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/chats/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/common-actions/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/media-detail-dialog.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/vars/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/conversions/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/events/bookings/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/friends/detail/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/friends/migrations/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/hq/support/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/inflow-links/_components/edit-route-modal.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/inflow-links/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/line-notifications/operator/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/mileage/earning-rules/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/mileage/rewards/edit/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/nen-members/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/nen/pets/pet-editor.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/ops/announcements/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/ops/support/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/pools/new/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/pools/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/restaurant-test/restaurant-console.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/scenarios/detail/scenario-detail-client.tsx':
    's1: シナリオ詳細。手動保存で番兵なし。V6R-S1-d（board#1065）で付ける',
  'app/scenarios/first-step/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/tags/fields/edit/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/tags/fields/migrate/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/templates/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/templates/template-asset-editor.tsx':
    's2: テンプレート編集の本体（app/templates/edit から載る）。V6R-S2-a（board#1066）で付ける',
  'app/webhooks/edit/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/webhooks/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/webhooks/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/webinars/new/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/accounts/account-edit-modal.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/auto-replies/edit-dialog.tsx':
    's2: 自動応答の編集。共通ダイアログは背景クリックとEscで閉じる。V6R-S2-a（board#1066）で付ける',
  'components/broadcasts/broadcast-asset-manager.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/broadcasts/broadcast-form.tsx':
    's2: 一斉配信の作成。手動保存で番兵なし。V6R-S2-a（kentavndng/line-harness-board#1066）で付ける',
  'components/events/event-form.tsx':
    's3: イベント作成。V6R-S3-b（board#1067）で付ける',
  'components/events/event-wizard.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friend-fields/edit-tag-page-v4.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friend-fields/support-mark-editor.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friend-fields/support-mark-rules-panel.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friends/advanced-search-dialog.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friends/single-friend-actions.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/ops/knowledge-editor.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/scenarios/action-editor.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
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

function editorFiles(): string[] {
  const found: string[] = []
  for (const root of ['app', 'components']) {
    for (const path of tsxFiles(join(SRC, root))) {
      const source = readFileSync(path, 'utf8')
      if (DIRTY_SIGNATURE.test(source)) continue
      if (!EDITOR_SAVE_SIGNATURE.test(source)) continue
      if ((source.match(EDITOR_INPUT_SIGNATURE) ?? []).length < EDITOR_MIN_INPUTS) continue
      found.push(path.slice(SRC.length + 1))
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

  it('dirty を持たない編集画面も、分類か未判定の一覧のどちらかに載っている（V6R-S0-c）', () => {
    const known = new Set([
      ...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS), ...Object.keys(UNTRIAGED),
    ])
    const unclassified = editorFiles().filter((file) => !known.has(file))
    expect(
      unclassified,
      '保存の口と入力欄を持つ編集画面が未分類です。useUnsavedGuard を付けて GUARDED へ、' +
        'または理由を書いて EXEMPTIONS へ追加してください（UNTRIAGED への追加は禁止）',
    ).toEqual([])
  })

  it('未判定の一覧は、まだ番兵が無く・まだ編集画面の印を持つものだけ（直したら一覧から消す）', () => {
    const editors = new Set(editorFiles())
    for (const file of Object.keys(UNTRIAGED)) {
      const source = readFileSync(join(SRC, file), 'utf8')
      expect(source.includes('useUnsavedGuard('), `${file} は番兵が付いたので GUARDED へ移す`).toBe(false)
      expect(editors.has(file), `${file} はもう編集画面の印が無いので UNTRIAGED から消す`).toBe(true)
    }
  })
})
