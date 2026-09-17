import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FLOW = readFileSync(join(ROOT, 'src/components/reminders/reminder-publish-flow.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(ROOT, 'src/app/reminders/new/page.tsx'), 'utf8')
const STEP_EDITOR = readFileSync(join(ROOT, 'src/app/reminders/edit/issue469-reminder-screens.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(ROOT, 'src/app/reminders/edit/page.tsx'), 'utf8')
const DETAIL_PAGE = readFileSync(join(ROOT, 'src/app/reminders/detail/page.tsx'), 'utf8')
const API = readFileSync(join(ROOT, 'src/lib/api.ts'), 'utf8')
const WORKER_ROUTE = readFileSync(join(ROOT, '../worker/src/routes/reminders.ts'), 'utf8')

describe('V6 リマインダの公開フロー', () => {
  it('未実装だった5画面を実Node IDで接続する', () => {
    for (const nodeId of ['s7T2dz', 'JCz6J', 'W98zZQ', 's6Vvp', 'PSmHo']) {
      expect(FLOW).toContain(`data-design-node="${nodeId}"`)
    }
  })

  it('作成時に公開せず、下書きから対象確認へ進む', () => {
    expect(NEW_PAGE).toContain('api.reminders.createDraft(settings)')
    expect(NEW_PAGE).toContain('&stage=target')
    expect(NEW_PAGE).not.toContain('api.reminders.addStep(res.data.id')
  })

  it('確認・テスト送信・公開を同じ版のAPIへ通す', () => {
    expect(API).toContain('/api/reminders/${id}/draft')
    expect(API).toContain('/api/reminders/${id}/preview')
    expect(API).toContain('/api/reminders/${id}/test-send')
    expect(API).toContain('/api/reminders/${id}/validate')
    expect(API).toContain('/api/reminders/${id}/publish')
    expect(FLOW).toContain("draft.lastTestStatus !== 'succeeded'")
    expect(FLOW).toContain('!validation?.valid')
  })

  it('未取得の人数を0人に見せない', () => {
    expect(FLOW).toContain("value == null ? `—${unit}`")
    expect(FLOW).toContain("audience.matched")
    expect(FLOW).toContain("audience.excluded")
  })

  it('本文に大見出しを重ねず、共通トップバーへ任せる', () => {
    expect(FLOW).not.toContain('<Header')
    expect(FLOW).not.toContain('<h1')
  })

  it('配信予定は仮の基準日を明示する', () => {
    expect(FLOW).toContain('preview.targetDate')
    expect(FLOW).toContain('とした場合の送信予定です')
  })

  it('押しても動かないボタンは描かない（出す＝使える）', () => {
    /*
     * 点検では disabled＋「準備中」も挙がったが、共通ルール §7-10 は
     * 「準備中 のボタンが1つも無い（出す＝使える）」、§5-5 は
     * 「隠すのではなく、そもそも描かない」を完了条件にしている。
     * 動くまで描かず、押せるのに何も起きない状態を作らない。
     */
    for (const label of ['条件を編集', '＋ アクションを追加']) {
      expect(FLOW, `${label} が公開フローに描かれています`).not.toContain(`>${label}<`)
    }
    for (const label of ['＋ フォルダを追加', 'ひな形を管理', 'このひな形を使う']) {
      expect(NEW_PAGE, `${label} が新規作成に描かれています`).not.toContain(`>${label}<`)
    }
    /*
     * 追加・削除・並べ替えはN-066で実動作にした。描くのは問題なく、
     * 動作は reminder-step-editor.react.test.tsx が保証する。
     * まだ動かない「複製」「通知イメージを見る」は描かないままにする。
     */
    for (const label of ['この通知を複製', '通知イメージを見る', '＋ アクションを追加']) {
      expect(STEP_EDITOR, `${label} が通知編集に描かれています`).not.toContain(`>${label}<`)
    }
  })

  it('固定の人数・日時・停止予定・架空の例値を残さない', () => {
    /*
     * N-071/N-079 で見つかった見せかけの値。APIの実値か明示的な未取得へ
     * 変えたあと、同じ固定値が戻らないよう名前で固定する。
     */
    const FIXED = [
      '71人', '82人', '2人が重複', '1,194通',
      'テスト済み 2026/09/06 18:00', '08:00〜21:00', '翌朝に繰り越す',
      'meet.google.com', '前日・1時間前・当日', '8/24（月）', '8/26 09:00',
      'Kentaさん', '>Kenta<',
    ]
    for (const literal of FIXED) {
      expect(FLOW, `${literal} が公開フローに残っています`).not.toContain(literal)
      expect(STEP_EDITOR, `${literal} が通知編集に残っています`).not.toContain(literal)
      expect(DETAIL_PAGE, `${literal} が詳細に残っています`).not.toContain(literal)
    }
  })

  it('実装の無いSlack通知を約束しない', () => {
    // Worker にリマインダからSlackへ送る経路は無い。画面だけの約束は撤去済み。
    expect(FLOW).not.toContain('Slack')
    expect(WORKER_ROUTE).not.toContain('slack')
  })

  it('押しても動かないボタンを残さない', () => {
    // 完了画面の主ボタンは詳細画面への実リンクを持つ。
    expect(FLOW).toContain('/reminders/detail?id=${draft.reminderId}')
    expect(FLOW).toContain('>通知予定を確認<')
    // 絞り込みボタンは state を実際に切り替える。
    expect(FLOW).toContain('setRange(')
    // 「戻って修正」は編集画面への実遷移を持つ。
    expect(FLOW).not.toContain("secondary={{ label: '戻って修正' }}")
    // テスト段のフッターは固定日時ではなく下書きの記録を見る。
    expect(STEP_EDITOR).not.toContain('status="テスト済み')
    // 詳細の停止予定は固定の「—」ではなく公開版の実値を見る。
    expect(DETAIL_PAGE).not.toContain('label="停止予定" value="—"')
    expect(DETAIL_PAGE).toContain('reminderStopSummary')
    expect(WORKER_ROUTE).toContain('stopConditions: publishedSettings?.stopConditions ?? null')
  })

  it('使っていない二重実装を残さない', () => {
    expect(existsSync(join(ROOT, 'src/components/reminders/reminder-step-editor-v6.tsx'))).toBe(false)
    expect(EDIT_PAGE).not.toContain('LegacyReminderEditInner')
  })
})
