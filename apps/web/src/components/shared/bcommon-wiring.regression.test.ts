import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { expect, it } from 'vitest'
const read = (path: string) => readFileSync(`src/${path}`, 'utf8')
it('WEB-006: 枠なしの選ぶ欄も焦点を消さない', () => {
  expect(read('components/shared/select.module.css')).toMatch(/\.textTrigger:focus-visible\s*\{[^}]*outline:[^}]*var\(--color-action\)/)
})
it('WEB-019: 自動応答の未接続のつまみを描かない', () => {
  expect(read('components/auto-replies/inline-action-rows-v8.tsx')).not.toContain('<GripVertical')
})
it('共通点検1: 未分類は開いたフォルダ', () => {
  // 選ぶ窓のフォルダの列は共通の FolderPanel（pickfold）。未分類の印は部品が開いたフォルダで描く。
  expect(read('v8/inbox-chat/template-picker-view.tsx')).toContain('<FolderPickerShell')
  expect(read('components/shared/folder-picker-shell.tsx')).toContain('<FolderPanel readOnly')
  expect(read('components/shared/folder-panel.tsx')).toMatch(/kind === 'unfiled' \? <FolderOpen/)
})
it('共通点検2: タグ編集の切替は共通Toggle', () => {
  const source = read('components/friend-fields/tag-editor-v4.tsx')
  expect(source).toContain("from '@/components/shared/toggle'")
  expect(source).not.toContain('h-7 w-12')
})
it('共通点検3: 会話右欄のタグは共通TagPill', () => {
  expect(read('components/chats/friend-info-sidebar.tsx')).toContain('<TagPill')
})
it('共通点検4・5・10: タグ一覧の札・行操作・入力を共通に置く', () => {
  const source = read('v8/tags/tags-tab.tsx')
  expect(source).toContain('<StatusBadge')
  expect(source).toMatch(/<RowMenu\s+size="row"/)
  expect(read('v8/tags/list.module.css')).not.toContain('button.menuButton')
  expect(source).toContain('<FolderEditorDialog')
})
it('共通点検6: 通知の表見出しは共通の行', () => {
  expect(read('v8/reminders/detail.tsx')).toContain('<TableHeadRow')
})
it('共通点検7: 情報欄の空・失敗・権限を共通ListStateで言い分ける', () => {
  const source = read('v8/tags/fields-tab.tsx')
  expect(source).toContain('<ListState kind="forbidden"')
  expect(source).toContain('<ListState kind="empty"')
  expect(source).not.toContain('styles.stateCard')
})
it('共通点検8: 共通情報のまとめ操作はBulkBar', () => {
  const source = read('v8/common-vars/list.tsx')
  expect(source).toContain('<BulkBar')
  expect(source).not.toContain('className={styles.bulkRow}')
})
it('共通点検9: 紹介者の右面は620幅の共通Drawer', () => {
  const source = read('v8/affiliates/drawer.tsx')
  expect(source).toContain('<Drawer')
  expect(source).toContain('designWidth={620}')
  expect(source).not.toContain('className={styles.drawer}')
})

it('共通点検5: 小さい行のボタンはブラウザ既定の余白を足さない', () => {
  expect(read('components/shared/icon-button.module.css')).toMatch(/\.button\s*\{[^}]*padding: 0;/s)
})
it('WEB253: span内の旧SVGにもV8のアイコン寸法を渡す', () => {
  expect(read('components/layout/sidebar.tsx')).toContain('<NavIcon className={isV8 ? styles.v8NavIcon : undefined}')
})

it('共通点検4・5: 同じCSSを使う残りの3タブも消した札とボタンの上書きを見ない', () => {
  for (const tab of ['fields-tab', 'marks-tab', 'searches-tab']) {
    const source = read(`v8/tags/${tab}.tsx`)
    expect(source).not.toContain('styles.menuButton')
    expect(source).not.toContain('styles.miniBadge')
    expect(source).toMatch(/<RowMenu\s+size="row"/)
  }
})
