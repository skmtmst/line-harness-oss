// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SettingsPage } from './settings-page'
import { ListPageBody } from './list-page'
import { FolderDotName } from '@/components/shared/folder-dot'
import { readFileSync } from 'node:fs'
afterEach(cleanup)
it("設定の絵の違いを型の口から指定し、画面CSSから上書きしない", () => {
  const view = render(<SettingsPage {...{ layout: 'narrow-nav' }} title="設定" navigation="目次">内容</SettingsPage>)
  expect(view.container.querySelector('[data-page-template="settings"]')?.getAttribute('data-template-layout')).toBe('narrow-nav')
  const screenCss = readFileSync('src/v8/settings/sb-frame/settings-screen.module.css', 'utf8')
  expect(screenCss).not.toContain(':global(')
})

it('フォルダがない設定表は未分類の丸を出さず、名前を残す', () => {
  const view = render(<SettingsPage title="通知" navigation="目次"><FolderDotName>注文が確定したとき</FolderDotName></SettingsPage>)
  expect(view.queryByRole('img', { name: 'フォルダ：未分類' })).toBeNull()
  expect(view.getByText('注文が確定したとき')).toBeTruthy()
})
it('設定の中でもフォルダを持つ一覧の明示指定を保つ', () => {
  const view = render(<SettingsPage title="設定" navigation="目次"><ListPageBody folders="フォルダ"><FolderDotName folder={{ name: '会員' }}>会員の案内</FolderDotName></ListPageBody></SettingsPage>)
  expect(view.getByRole('img', { name: 'フォルダ：会員' })).toBeTruthy()
})
