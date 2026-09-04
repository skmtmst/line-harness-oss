import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const DIALOG = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'components', 'shared', 'confirm-dialog.tsx'),
  'utf8',
)

describe('V6 流入リンクの削除確認 UIaM7', () => {
  it('ブラウザ標準の確認ではなく共通ダイアログを使う', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE).not.toMatch(/\b(?:window\.)?confirm\s*\(/)
    expect(PAGE).toContain('designNode="UIaM7"')
    expect(DIALOG).toContain('designNode={designNode}')
  })

  it('対象名と削除後に残る記録、元に戻せないことを読み合わせる', () => {
    expect(PAGE).toContain('title={`「${route?.name ?? \'\'}」を削除しますか？`}')
    expect(PAGE).toContain('過去のクリック・友だち追加・成果の記録')
    expect(PAGE).toContain('すでに友だちへ保存された流入元は残ります')
    expect(PAGE).toContain('削除した設定は元に戻せません')
  })

  it('APIの成否を見て、失敗時は窓を閉じず画面の言葉を出す', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
    expect(PAGE).toContain('busy={deleting}')
    expect(PAGE).toContain('error={deleteError}')
    expect(PAGE).toContain(
      '流入リンクを削除できませんでした。状態を読み直してから、もう一度お試しください。',
    )
    expect(PAGE).toContain('if (deleting) return')
  })
})
