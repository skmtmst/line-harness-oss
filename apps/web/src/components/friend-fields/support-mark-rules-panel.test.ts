import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(join(__dirname, 'support-mark-rules-panel.tsx'), 'utf8')
/*
  **置き場は一覧ではなく編集画面。** 旧版はまだ編集が一覧の中にあったので
  `mark-list.tsx` へ繋いでいたが、いまマークの設定は
  `/tags/marks/edit?id=` の `SupportMarkEditor` に分かれていて、
  設計 `GMvBd` の印もそちらに付いている。
*/
const EDITOR = readFileSync(join(__dirname, 'support-mark-editor.tsx'), 'utf8')

/**
 * 画面側の配線。**考え方が正しくても、繋いでいなければ効かない。**
 * 純粋関数の試験（`support-mark-rules-view.test.ts`）と対で見る。
 */
describe('V6 対応マークの自動変更ルール（GMvBd）の配線', () => {
  it('名前・色・並び順・初期値と同じ面に置く', () => {
    expect(EDITOR).toContain('<SupportMarkRulesPanel')
    expect(EDITOR).toContain('markId={markId ?? null}')
    // 設計の印は編集画面が持つ。パネルはその中の一区画。
    expect(EDITOR).toContain('data-design-node="GMvBd"')
    expect(PANEL).toContain('data-qa-open="GMvBd"')
    // **作る前は出さない。** 保存先が無いので、押しても何も起きない。
    expect(EDITOR).toContain('{editing ? (')
  })

  it('開いたときに書き込みの口を呼ばない', () => {
    /*
      ほかの画面で、開いただけで試験送信が走り、公開の条件を満たして
      しまったことがある。読み込みの効果から書き込みを呼ばない。
    */
    const effect = PANEL.slice(PANEL.indexOf('useEffect(() => {'), PANEL.indexOf('if (!markId)'))
    for (const write of ['createAutomationRule', 'updateAutomationRule', 'archiveAutomationRule']) {
      expect(effect).not.toContain(write)
    }
    expect(effect).toContain('void load()')
  })

  it('読み込みは取得の口だけを呼ぶ', () => {
    const load = PANEL.slice(PANEL.indexOf('const load = useCallback'), PANEL.indexOf('useEffect(() => {'))
    expect(load).toContain('api.supportMarks.automationRules')
    for (const write of ['createAutomationRule', 'updateAutomationRule', 'archiveAutomationRule']) {
      expect(load).not.toContain(write)
    }
  })

  it('アカウントとマークが変わったら前の内容と結果をその場で捨てる', () => {
    const effect = PANEL.slice(PANEL.indexOf('useEffect(() => {'), PANEL.indexOf('if (!markId)'))
    for (const reset of ['setRules([])', 'setFailure(null)', 'setEditingId(null)', 'setPendingArchive(null)']) {
      expect(effect).toContain(reset)
    }
    expect(PANEL).toContain('}, [accountId, markId, load])')
  })

  it('遅い返事は3つで照合してから受け取る', () => {
    expect(PANEL).toContain('isCurrentResponse(requestRef.current, at)')
    expect(PANEL).toContain('if (!stillHere()) return')
  })

  it('版競合では窓を閉じず、読み直す押し口を出す', () => {
    // 閉じると、直した内容が消えたのか保存できたのか分からなくなる。
    const save = PANEL.slice(PANEL.indexOf('const save = async'), PANEL.indexOf('const archive = async'))
    const failureBranch = save.slice(save.indexOf('} catch (err) {'))
    expect(failureBranch).not.toContain('setEditingId(null)')
    expect(failureBranch).toContain('failureOf({ status:')
    expect(PANEL).toContain('failure.canReload')
    expect(PANEL).toContain('最新の内容を読み直す')
  })

  it('成功したときだけ窓を閉じる', () => {
    const save = PANEL.slice(PANEL.indexOf('const save = async'), PANEL.indexOf('const archive = async'))
    const happyPath = save.slice(0, save.indexOf('} catch (err) {'))
    expect(happyPath).toContain("if (!res.success) throw new Error('failed')")
    // 断られたときに閉じないよう、閉じるのは成功の確認より後に置く。
    expect(happyPath.indexOf('setEditingId(null)')).toBeGreaterThan(happyPath.indexOf('if (!res.success)'))
  })

  it('読込中・0件・取得失敗・権限不足を混ぜない', () => {
    for (const kind of ['kind="loading"', 'kind="forbidden"', 'kind="error"', 'kind="empty"']) {
      expect(PANEL).toContain(kind)
    }
    // 取得失敗のときに空の文言を出さない。
    expect(PANEL).toContain('title={LIST_ERROR.title}')
    expect(PANEL).toContain('title={LIST_EMPTY.title}')
  })

  it('停止は履歴を消さないことを窓に書く', () => {
    const dialog = PANEL.slice(PANEL.indexOf('<ConfirmDialog'))
    expect(dialog).toContain('これまでの変更履歴は監査記録として残ります。')
    expect(dialog).toContain('このルールを停止')
  })

  it('実行順そのものを並びにする', () => {
    expect(PANEL).toContain('inExecutionOrder(res.data)')
    expect(PANEL).toContain('{MULTI_MATCH_NOTE}')
  })
})
