// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import type { Tag } from '@line-crm/shared'
import { TagEditForm } from '@/v8/tag-edit/edit-form'
import { getPageAction } from '@/test-utils/page-action'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8')
const EDITOR = read('v8/tag-edit/edit-form.tsx')
const MODEL = read('v8/tag-edit/model.ts')
const SAVE = read('v8/tag-edit/edit.tsx')

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    commonActions: { ...actual.api.commonActions, resources: async () => ({ success: false, error: 'not configured' }) },
    tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
  } }
})
afterEach(cleanup)

function renderCopyAction() {
  const save = vi.fn(), remove = vi.fn()
  render(React.createElement(TagEditForm, {
    tag: { id: 'copy-source', name: '会員', status: 'active', linkedEnabled: false } as Tag,
    groups: [], dependencies: null, accountId: 'account-1', readOnly: false, conflict: false, compareBusy: false,
    onCompare: vi.fn(), onReloadLatest: vi.fn(), retroactiveReference: false, initialActions: [], saving: false,
    error: '', onCancel: vi.fn(), onSave: save, onDelete: remove,
  }))
  return { action: getPageAction({ name: '複製して作る', exact: true }), save, remove }
}

describe('現役V8のタグ編集', () => {
  it('友だち一覧の表示設定は現在の編集の選ぶ欄から変える', () => {
    expect(EDITOR).toContain('label="友だち一覧に出す"')
    expect(EDITOR).toContain('checked={isStarred} onChange={setIsStarred}')
    expect(EDITOR).not.toContain('タグ一覧の星をクリック')
  })
  it('連動がOFFでも使える用途とONにしたあとの設定を案内する', () => {
    expect(EDITOR).toContain('手動付与・配信の絞り込み・シナリオの条件には使えます')
    expect(EDITOR).toContain('付いたときの動きとマイルを決められます')
    expect(MODEL).toContain("label: '1.2倍'")
    expect(EDITOR).toContain('<LinkedActionList')
  })
  it('OFFに戻しても積んだマイルは取り消されないことを伝える', () => {
    expect(EDITOR).toContain('オフに戻すと、これ以降このタグが付いても連動は動きません')
    expect(EDITOR).toContain('すでに積んだマイルは取り消されません')
  })
  it('使い道と使っている所を現在の右欄で確認できる', () => {
    expect(EDITOR).toContain('使っている所')
    expect(MODEL).toContain("label: '一斉配信'")
    expect(MODEL).toContain("label: '回答フォーム'")
    expect(EDITOR).toContain('row.count > 0 && row.href')
  })
  it('編集から同じタグを複製して作れる', () => {
    expect(EDITOR).toContain('複製して作る')
    const { action, save, remove } = renderCopyAction()
    expect(action.getAttribute('href')).toBe('/tags/new?copy=copy-source')
    expect(save).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
  it('R620: 遡及OFFでは既存へ反映せず、確認した時だけ反映する', () => {
    expect(EDITOR).toContain('if (applyToExisting && (tag.friendCount ?? 0) > 0')
    expect(SAVE).toContain('applyToExisting: applyRetroactive && values.applyToExisting')
  })
})
