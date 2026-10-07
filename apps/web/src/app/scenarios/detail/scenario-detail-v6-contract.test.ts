import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(
  path.join(__dirname, 'scenario-detail-client.tsx'),
  'utf8',
)
/* 一覧の入口は src/v8/scenarios/list.tsx（2026-10-06〜。古い list-v8.tsx はもう描かれない）。 */
const LIST = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'v8', 'scenarios', 'list.tsx'), 'utf8')
const LIST_TABLE = LIST
const DIALOGS = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'scenarios', 'scenario-dialogs.tsx'),
  'utf8',
)

describe('V6 シナリオ編集の契約', () => {
  it('上部の一括テスト送信を既存の全通テスト送信へ接続する', () => {
    expect(PAGE).toContain(
      "onClick={() => setTestSend({ stepId: null, label: 'このシナリオの全通' })}",
    )
    expect(PAGE).not.toContain('一括テスト送信は準備中です')
    expect(PAGE).toContain('lineAccountId={scenario?.lineAccountId ?? null}')
  })

  it('一括テスト送信の操作を画面内に重複させない', () => {
    expect(PAGE.match(/>\s*一括でテストを送る\s*<\/Button>/g)).toHaveLength(1)
  })

  it('テスト送信先を同じLINEアカウントから取得し、失敗後も操作へ戻れる', () => {
    expect(DIALOGS).toContain('accountId: lineAccountId ?? selectedAccountId ?? undefined')
    expect(DIALOGS).toContain("setFriendsStatus('loading')")
    expect(DIALOGS).toContain("setFriendsStatus('error')")
    expect(DIALOGS).toContain('finally {')
    expect(DIALOGS).toContain('setSending(false)')
  })

  it('フォルダ候補はシナリオ所属アカウントで取り、候補外の保存値は理由を示して保持する', () => {
    /*
     * SCENARIO-20: 無指定の folders.list は全権限範囲を返すため、
     * 別アカウントの同名フォルダを選んで保存できてしまう。
     * 所属アカウント（共通なら選択中）の候補だけを出し、
     * アカウントが切り替わったら取り直す。
     */
    expect(PAGE).toContain('const folderAccountId = scenario?.lineAccountId ?? selectedAccountId')
    expect(PAGE).toContain("api.folders.list('scenario', folderAccountId ?? undefined)")
    expect(PAGE).not.toContain("api.folders.list('scenario')")
    expect(PAGE).toContain('[folderAccountId]')
    // 候補に無い保存値は消さず「名前を確認できません」として残し、理由を示す。
    expect(PAGE).toContain('editFolderMissing')
    expect(PAGE).toContain('名前を確認できません')
    expect(PAGE).toContain('このアカウントの候補にありません')
    // 候補を取り直せないあいだは変更を止める（別範囲の値を黙って保存しない）。
    expect(PAGE).toContain("disabled={folderState !== 'ready'}")
    expect(PAGE).toContain('フォルダを確認できないため、いまは変更できません。')
  })

  it('一覧のフォルダ追加を既存の共通ダイアログへ接続する', () => {
    expect(LIST).toContain("import FolderAddDialog from '@/components/shared/folder-add-dialog'")
    expect(LIST).toContain('() => setFolderDialogOpen(true)')
    expect(LIST).toContain('kind="scenario"')
    expect(LIST).not.toContain('title="準備中です"\n          className="border-hairline text-ink-faint rounded-control border px-4')
  })

  it('一覧本文は題ブロックを置かず、開始案内を出す', () => {
    expect(LIST).not.toContain("import Header from '@/components/layout/header'")
    expect(LIST).not.toContain('<Header')
    expect(LIST).not.toContain('配信のタイミングを指定して複数のメッセージを順に送ります。')
    // 新しい一覧の案内の帯の言い方は「作っただけでは送られません」。
    expect(LIST).toContain('作っただけでは送られません')
    expect(LIST).toContain('配信を始める方法・3手順')
    // 並びは絵（axFrW）どおり：案内の帯は道具の段の先頭（表の上の主列）に置く。
    // 古い一覧の「案内の帯 → 数の帯」の順は新しい絵で変わったので見ない。
    expect(LIST).toContain('{noteBand}')
  })

  it('作ったフォルダへ一覧からシナリオを移せる', () => {
    /*
      NEXT-25: 各行の幅176pxのフォルダ select は名前列を潰していたため、
      行の「その他→フォルダを移動」と複数選択の一括操作へ集約した。
      移動先を選ぶ窓の select は `v6-select` のまま。
    */
    expect(LIST).toContain('const folderId = moveDraft || null')
    expect(LIST).toContain('api.scenarios.update(id, { folderId })')
    expect(LIST).toContain("failureMessage: 'フォルダを移動できませんでした。'")
    expect(LIST).toContain('フォルダへ移す')
    expect(LIST_TABLE).toContain('フォルダ')
    // 移動先の選び欄は共通 Select（素の select・v6-select は置かない）。
    expect(LIST_TABLE).toContain('<Select')
    expect(LIST_TABLE).toContain('aria-label="移動先のフォルダ"')
    expect(LIST_TABLE).toContain('フォルダへ移す')
    expect(LIST_TABLE).toContain('onConfirm={() => runMove()}')
    expect(LIST_TABLE).toContain('undo: () => setOptimisticRows(null)')
  })

  it('「今月作成」は日本時間の月初を共通一覧APIへ渡して絞り込む', () => {
    expect(LIST).toContain("timeZone: 'Asia/Tokyo'")
    // 新しい一覧は「停止中のみ」（0）と「稼働中のみ」（1）を1つの値にまとめて口へ渡す。
    expect(LIST).toContain("stoppedOnly ? 0 : savedFilter === 'active' ? 1 : undefined")
    expect(LIST).toContain('active: activeParam,')
    // m13i: 札は共通 FilterChip になった（選択表示は部品が持つ）。絞りの動きは同じ。
    // 新しい一覧の札の言い方は「今月作った」。
    expect(LIST).toContain('今月作った')
    expect(LIST).toContain('createdFrom: createdThisMonthOnly ? currentMonthStart() : undefined')
    expect(LIST).not.toContain('createdThisMonthOnly ? isCreatedThisMonth(sc.createdAt) : true')
  })
})
