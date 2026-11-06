// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExternalImportWorkspace } from './external-import'

afterEach(cleanup)

// 決まり2: 変わらない物の説明は帯にせず、題の横の「？」へ入れる。
it('取り込んでも変わらない説明は帯に出さず題の「？」に入れる', async () => {
  render(<ExternalImportWorkspace external={{ currentDefault: null, lineMenus: [
    { richMenuId: 'rm-1', name: '外のメニュー', chatBarText: '開く', size: { width: 2500, height: 1686 }, areasCount: 2 },
  ] }} loading={false} error={null}
    onBack={() => {}} onReload={() => {}} onImport={() => {}} />)
  await screen.findByText(/取り込むと、できるようになること/)
  expect(screen.queryByText(/中身をこちらで持つようになるだけです/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '取り込んでも変わらない物の説明' }))
  expect(await screen.findByText(/中身をこちらで持つようになるだけです/)).toBeTruthy()
})


it('LINE読取の失敗は分かっている理由を表示し、再読込を呼ぶ', () => {
  const retry = vi.fn()
  render(<ExternalImportWorkspace external={null} loading={false} error="LINE連携の認証情報を確認できません。連携の設定を確認してください。" onBack={() => {}} onReload={retry} onImport={() => {}} />)
  expect(screen.queryByText('LINE連携の認証情報を確認できません。連携の設定を確認してください。')).not.toBeNull()
  expect(screen.queryByText('管理画面の外のメニューはありません')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む', exact: true }))
  expect(retry).toHaveBeenCalledTimes(1)
})


it('LINE読取の失敗は前の一覧があっても理由を出し、古い取込候補を現在の物として見せない', () => {
  render(<ExternalImportWorkspace external={{ currentDefault: null, lineMenus: [{ richMenuId: 'old', name: '前に読んだメニュー', chatBarText: '開く', size: { width: 2500, height: 843 }, areasCount: 0, isCurrentDefault: false, adminManaged: false, adminInfo: null }] }} loading={false} error="LINEへの問い合わせが集中しています。少し待ってから、もう一度読み込んでください。" onBack={() => {}} onReload={() => {}} onImport={() => {}} />)
  expect(screen.queryByText('LINEへの問い合わせが集中しています。少し待ってから、もう一度読み込んでください。')).not.toBeNull()
  expect(screen.queryAllByText('前に読んだメニュー')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'この内容で取り込む' })).toBeNull()
})
