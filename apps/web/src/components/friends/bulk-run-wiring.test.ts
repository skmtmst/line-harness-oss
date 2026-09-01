import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIALOG = readFileSync(join(__dirname, 'bulk-run-dialog.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, '..', '..', 'app', 'friends', 'page.tsx'), 'utf8')

/** 画面側の配線。**考え方が正しくても、繋いでいなければ効かない。** */
describe('V6 友だち一括操作（IAf7j）の配線', () => {
  it('既存の /friends の中に作り、別ルートを増やさない', () => {
    expect(PAGE).toContain('<BulkRunDialog')
    expect(DIALOG).toContain('data-design-node="IAf7j"')
    expect(PAGE).toContain('data-qa-open="IAf7j"')
  })

  it('owner/admin 以外には押し口を出さない', () => {
    /*
      **押し口を出す条件そのものを見る。** `canRunBulk` がファイルの
      どこかにあるだけでは、押し口の分岐から外されても気づけない
      （実際に、条件から外しても落ちない試験になっていた）。
    */
    expect(PAGE).toContain('{selectedIds.size > 1 && canRunBulk(selectedAccount?.role) ? (')
    expect(PAGE).toContain('{selectedIds.size > 1 && !canRunBulk(selectedAccount?.role) ? (')
    expect(PAGE).toContain('一括操作ができるのはオーナーと管理者だけです')
  })

  it('作る前に必ず対象を数え直す', () => {
    /*
      選んだ人数がそのまま対象になるとは限らない。除外はサーバーが決める。
      画面の選択数を実行数として扱うと、除外された人まで「やった」ことになる。
    */
    const load = DIALOG.slice(DIALOG.indexOf('const loadPreview'), DIALOG.indexOf('useEffect(() => {'))
    expect(load).toContain('api.friends.bulkPreview')
    expect(load).not.toContain('api.friends.bulkCreate')
    // 確認の面は数え直したあとにだけ出る。
    expect(load).toContain("setPhase('confirm')")
  })

  it('開いたときに書き込みの口を呼ばない', () => {
    const effect = DIALOG.slice(DIALOG.indexOf('useEffect(() => {'), DIALOG.indexOf('if (!open) return null'))
    for (const w of ['bulkCreate', 'bulkRetry', 'bulkUndo', 'bulkPreview']) {
      expect(effect).not.toContain(`api.friends.${w}`)
    }
  })

  it('遅い返事は3つで照合してから受け取る', () => {
    expect(DIALOG).toContain('contextRef.current.open')
    expect(DIALOG).toContain('contextRef.current.accountId === at.accountId')
    expect(DIALOG).toContain('contextRef.current.targetKey === at.targetKey')
    expect(DIALOG).toContain('requestRef.current.generation === at.generation')
    expect(DIALOG).toContain('if (!stillHere()) return')
    // 次のpreviewを押さなくても、アカウント・対象の変更だけで古い返事を無効にする。
    expect(DIALOG).toContain('}, [accountId, open, targetKey])')
    expect(DIALOG).toContain('resultRequestRef.current += 1')
    expect(DIALOG).toContain('targetKey,\n      generation:')
    expect(DIALOG).not.toContain("targetKey: friendIds.join(',')")
  })

  it('書き込み中にアカウントや対象が変わっても、古い結果を窓へ戻さない', () => {
    expect(DIALOG.match(/const started = \{ accountId, targetKey \}/g)).toHaveLength(3)
    expect(DIALOG.match(/if \(!stillHere\(\)\)/g)?.length).toBeGreaterThanOrEqual(6)
  })

  it('Workerが受け付けるUUIDを使い、返事不明の再試行では同じ鍵を保つ', () => {
    expect(DIALOG).toContain('new IdempotencyKeyStore()')
    expect(DIALOG).toContain('createKeysRef.current.get(signature)')
    expect(DIALOG).toContain('createKeysRef.current.clear(signature)')
    expect(DIALOG).toContain('undoKeysRef.current.get(signature)')
    expect(DIALOG).not.toContain('Date.now()')
  })

  it('202の受付を完了扱いせず、確定するまで結果を読み直す', () => {
    expect(DIALOG).toContain('RESULT_POLL_LIMIT')
    expect(DIALOG).toContain('isRunComplete(response.data.status)')
    expect(DIALOG).toContain("void pollRun(res.data.id, 'execute')")
    expect(DIALOG).toContain("void pollRun(detail.id, 'retry')")
    // 取り消しは別実行なので、元のdetail.idではなく返されたIDを追う。
    expect(DIALOG).toContain("void pollRun(res.data.id, 'undo')")
    expect(DIALOG).not.toContain('api.friends.bulkGet(detail.id)')
  })

  it('結果の読込失敗で一括操作そのものをもう一度作らない', () => {
    expect(DIALOG).toContain("if (phase === 'result' && runId) void pollRun(runId, resultAction)")
    const poll = DIALOG.slice(DIALOG.indexOf('const pollRun'), DIALOG.indexOf('useEffect(() => {'))
    expect(poll).toContain('api.friends.bulkGet(id)')
    expect(poll).not.toContain('bulkCreate')
  })

  it('取り消せない操作は追加確認を送る', () => {
    expect(DIALOG).toContain('reversible ? {} : { confirmIrreversible: true }')
    expect(DIALOG).toContain('この操作は取り消せません')
  })

  it('やり直しは失敗した対象だけ、取り消しは取り消せる操作だけ', () => {
    expect(DIALOG).toContain('canRetry(detail)')
    expect(DIALOG).toContain('canUndo(detail)')
    expect(DIALOG).toContain('だけやり直す')
  })

  it('読込中・取得失敗・権限不足を分ける', () => {
    for (const k of ['kind="loading"', 'kind="error"', 'kind="forbidden"']) expect(DIALOG).toContain(k)
    // 権限不足では候補も個人情報も描かない。
    const forbidden = DIALOG.slice(DIALOG.indexOf("previewState === 'forbidden'"))
    expect(forbidden.slice(0, 400)).not.toContain('preview.sample')
  })

  it('閉じたら前の結果を持ち越さない', () => {
    const effect = DIALOG.slice(DIALOG.indexOf('useEffect(() => {'), DIALOG.indexOf('if (!open) return null'))
    for (const r of ['setPreview(null)', 'setDetail(null)', 'setFailure(null)']) expect(effect).toContain(r)
  })

  it('一覧の再読込では選択と一括操作の窓を一緒に閉じる', () => {
    expect(PAGE).toContain('const selectedFriendIds = useMemo(() => [...selectedIds], [selectedIds])')
    const load = PAGE.slice(PAGE.indexOf('const loadFriends'), PAGE.indexOf('const resetPageWith'))
    expect(load).toContain('setBulkOpen(false)')
    expect(load).toContain('setSelectedIds(new Set())')
  })

  it('内部IDを画面へ出さない', () => {
    /*
      名前が無いときは「名前未登録」。**`key=` は描画されない**ので、
      描く場所（`>{...}` と `{...}<`）だけを見る。
    */
    expect(DIALOG).toContain("item.displayName ?? '名前未登録'")
    expect(DIALOG).not.toMatch(/>\{item\.friendId\}/)
    expect(DIALOG).not.toMatch(/\{item\.friendId\}</)
    expect(DIALOG).not.toMatch(/>\{detail\.id\}/)
  })
})
