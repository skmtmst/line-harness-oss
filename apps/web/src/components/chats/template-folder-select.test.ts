import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const VIEW = readFileSync(join(HERE, '../../v8/inbox-chat/template-picker-view.tsx'), 'utf8')
const PANEL = readFileSync(join(HERE, '../shared/folder-panel.tsx'), 'utf8')
const API = readApiSource(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')
// PERF-12: フォルダの親子展開はサーバー側へ移った。画面は folder_id を
// そのまま渡し、直下の子を含める判断は Worker が行う。
const WORKER_TEMPLATES = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'templates.ts'),
  'utf8',
)

describe('受信箱のテンプレートフォルダ', () => {
  it('V8のフォルダ列で選択状態を確認できる', () => {
    expect(VIEW).toContain('<FolderPanel')
    expect(VIEW).toContain('activeId={side.active}')
    expect(VIEW).toContain('onSelect={(key) => props.onPickSide(')
    expect(PANEL).toContain('aria-pressed=')
    expect(VIEW).not.toContain('<select')
  })

  it('既存APIのfolderIdを落とさず、親を選ぶと子のテンプレートも出す', () => {
    expect(API).toContain('folderId: string | null;')
    // 画面は選んだ folder_id をそのまま渡す。
    expect(PICKER).toContain('folderId: folderId || undefined')
    expect(API).toContain("query.set('folder_id', params.folderId)")
    // 親を選んだとき直下の子も含めるのは Worker 側。
    expect(WORKER_TEMPLATES).toContain('id = ? OR parent_id = ?')
  })

  it('未分類と0件を、未取得と混同せず選べる', () => {
    expect(PICKER).toContain("value: '__none__'")
    expect(PICKER).toContain("label: '未分類'")
    expect(PICKER).toContain("countOf('')")
    // 未分類だけを返す絞り込みは Worker 側。
    expect(WORKER_TEMPLATES).toContain("folderParam === '__none__'")
    expect(PICKER).toContain('allCount: folderOptions[0]?.count ?? null')
    expect(PICKER).toContain("status: visibleFoldersStatus === 'error' ? 'error'")
    expect(VIEW).toContain('テンプレートを読み込めませんでした。もう一度開き直してください。')
    expect(PANEL).toContain('row.count === null ? null :')

  })

  it('開くたびに前のLINEアカウントの内容を消してから読み直す', () => {
    expect(PICKER).toContain('const { selectedAccountId } = useAccount()')
    expect(PICKER).toContain('loadedAccountId === selectedAccountId')
    // 空側は useMemo で固定した空配列（描画のたびに別物にならないように）。
    expect(PICKER).toContain('accountDataCurrent ? templates : emptyTemplates')
    expect(PICKER).toContain('accountDataCurrent ? folders : emptyFolders')
    expect(PICKER).toContain('setTemplates([])')
    expect(PICKER).toContain('setFolders([])')
    expect(PICKER).toContain("setTemplatesStatus('loading')")
    expect(PICKER).toContain("setFoldersStatus('loading')")
    expect(PICKER).toContain('}, [open, selectedAccountId])')
  })
})
