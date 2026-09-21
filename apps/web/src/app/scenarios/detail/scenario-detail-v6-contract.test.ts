import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(
  path.join(__dirname, 'scenario-detail-client.tsx'),
  'utf8',
)
const LIST = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
const LIST_TABLE = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'scenarios', 'scenario-list.tsx'),
  'utf8',
)
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
    expect(PAGE.match(/>\s*一括テスト送信\s*<\/button>/g)).toHaveLength(1)
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
    expect(LIST).toContain('onAddFolder={() => setFolderDialogOpen(true)}')
    expect(LIST).toContain('kind="scenario"')
    expect(LIST).not.toContain('title="準備中です"\n          className="border-hairline text-ink-faint rounded-control border px-4')
  })

  it('一覧本文は題ブロックを置かず、開始案内からKPIへ続く', () => {
    expect(LIST).not.toContain("import Header from '@/components/layout/header'")
    expect(LIST).not.toContain('<Header')
    expect(LIST).not.toContain('配信のタイミングを指定して複数のメッセージを順に送ります。')
    expect(LIST).toContain('作成しただけでは配信されません。開始条件を設定すると配信が始まります。')
    expect(LIST).toContain('配信を始める方法')
    expect(LIST.indexOf('作成しただけでは配信されません。')).toBeLessThan(
      LIST.indexOf('<ListKpis'),
    )
  })

  it('作ったフォルダへ一覧からシナリオを移せる', () => {
    /*
      NEXT-25: 各行の幅176pxのフォルダ select は名前列を潰していたため、
      行の「その他→フォルダを移動」と複数選択の一括操作へ集約した。
      移動先を選ぶ窓の select は `v6-select` のまま。
    */
    expect(LIST).toContain("api.scenarios.update(id, { folderId: folderId || null })")
    expect(LIST).toContain('onMoveFolders={handleMoveFolders}')
    expect(LIST_TABLE).toContain('フォルダ')
    expect(LIST_TABLE).toContain('className="v6-select')
    expect(LIST_TABLE).toContain("label: 'フォルダを移動'")
    expect(LIST_TABLE).toContain('onMoveFolders(moveIds, moveDraft)')
  })

  it('「今月作成」は日本時間の月初を共通一覧APIへ渡して絞り込む', () => {
    expect(LIST).toContain("timeZone: 'Asia/Tokyo'")
    expect(LIST).toContain('active: createdThisMonthOnly')
    expect(LIST).toContain('aria-pressed={filter.disabled ? undefined : filter.active}')
    expect(LIST).toContain('createdFrom: createdThisMonthOnly ? currentMonthStart() : undefined')
    expect(LIST).not.toContain('createdThisMonthOnly ? isCreatedThisMonth(sc.createdAt) : true')
  })
})
