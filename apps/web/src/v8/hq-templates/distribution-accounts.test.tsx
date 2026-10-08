// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Folder } from '@line-crm/shared'
import { accountsInFolder, distributionFolderRows, DistributionFolderPanel } from './distribution-accounts'

afterEach(cleanup)
describe('配布先をフォルダごとに選ぶ', () => {
  const folder = { id: 'direct', name: '直営店', color: '#2563eb', displayOrder: 0 } as Folder
  const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const membership = new Map([['a', { folderId: 'direct', folder }], ['b', { folderId: 'direct', folder }], ['c', { folderId: null, folder: null }]])
  it('一部選択は横棒。フォルダをまとめて選び、他フォルダの選択を保って外せる', () => {
    let selected = ['a', 'c']
    const rows = () => distributionFolderRows({ accounts, folders: [folder], membership, selected, onChange: (ids) => { selected = ids } })
    const { rerender } = render(<DistributionFolderPanel rows={rows()} activeId="all" onSelect={() => {}} failed={false} />)
    const check = screen.getByRole('checkbox', { name: '直営店をまとめて選ぶ' }) as HTMLInputElement
    expect(check.indeterminate).toBe(true)
    fireEvent.click(check)
    expect(selected).toEqual(['a', 'c', 'b'])
    rerender(<DistributionFolderPanel rows={rows()} activeId="direct" onSelect={() => {}} failed={false} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '直営店をまとめて選ぶ' }))
    expect(selected).toEqual(['c'])
  })
  it('取得していない所属を未分類にせず、権限付きの配布先集合から絞る', () => {
    expect(accountsInFolder([...accounts, { id: 'unknown' }], 'none', membership)).toEqual([{ id: 'c' }])
    expect(accountsInFolder(accounts, 'direct', membership)).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(accountsInFolder(accounts, 'none', null)).toEqual([])
  })
})
