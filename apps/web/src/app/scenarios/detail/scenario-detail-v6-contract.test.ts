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

describe('V6 シナリオ編集の契約', () => {
  it('上部の一括テスト送信を既存の全通テスト送信へ接続する', () => {
    expect(PAGE).toContain(
      "onClick={() => setTestSend({ stepId: null, label: 'このシナリオの全通' })}",
    )
    expect(PAGE).not.toContain('一括テスト送信は準備中です')
  })

  it('一括テスト送信の操作を画面内に重複させない', () => {
    expect(PAGE.match(/>\s*一括テスト送信\s*<\/button>/g)).toHaveLength(1)
  })

  it('一覧のフォルダ追加を既存の共通ダイアログへ接続する', () => {
    expect(LIST).toContain("import FolderAddDialog from '@/components/shared/folder-add-dialog'")
    expect(LIST).toContain('<Button onClick={() => setFolderDialogOpen(true)}>')
    expect(LIST).toContain('kind="scenario"')
    expect(LIST).not.toContain('title="準備中です"\n          className="border-hairline text-ink-faint rounded-control border px-4')
  })

  it('並び替えは既に使える行のつまみを案内し、マニュアルを最後に置く', () => {
    expect(LIST).toContain('⇅ 並び替えは ⠿ を掴む')
    expect(LIST).not.toContain('>\n              並び替え\n            </button>')
    expect(LIST.indexOf('⇅ 並び替えは ⠿ を掴む')).toBeLessThan(
      LIST.indexOf('マニュアル\n            </button>'),
    )
  })

  it('作ったフォルダへ一覧からシナリオを移せる', () => {
    expect(LIST).toContain("api.scenarios.update(id, { folderId: folderId || null })")
    expect(LIST).toContain('onMoveFolder={handleMoveFolder}')
    expect(LIST_TABLE).toContain('フォルダ')
    expect(LIST_TABLE).toContain('className="v6-select')
    expect(LIST_TABLE).toContain("onMoveFolder?.(s.id, event.target.value)")
  })
})
