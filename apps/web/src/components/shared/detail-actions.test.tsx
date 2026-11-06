// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DetailPanel from './detail-panel'
import Drawer from './drawer'
import Button from './button'
import { DetailPreview, DetailField, DetailInlineEdit, DetailNumber } from './detail-content'
import { PERMISSION_LOCK_REASON } from './permission-lock'

const identity = vi.hoisted(() => ({ role: 'owner' as string | null, reads: 0 }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => { identity.reads++; return identity.role } }))
vi.mock('./permission-lock', async importOriginal => ({ ...await importOriginal<typeof import('./permission-lock')>(), lockReason: () => identity.role === 'viewer' ? PERMISSION_LOCK_REASON.viewer : PERMISSION_LOCK_REASON.feature }))
afterEach(() => { cleanup(); identity.role = 'owner'; identity.reads = 0 })

for (const kind of ['panel', 'drawer', 'embedded'] as const) {
  describe(`${kind} の操作帯`, () => {
    function show(actions: React.ComponentProps<typeof DetailPanel>['actions']) {
      const child = <DetailField label="内容">記録は残ります</DetailField>
      return render(kind === 'panel' ? <DetailPanel open title="長い名前の全文" onClose={() => {}} actions={actions}>{child}</DetailPanel>
        : kind === 'drawer' ? <Drawer open title="長い名前の全文" onClose={() => {}} actions={actions}>{child}</Drawer>
        : <DetailPreview title="長い名前の全文" actions={actions}>{child}</DetailPreview>)
    }
    it('主・副は1つずつ、削除はメニューから元の確認へ進む', () => {
      const open = vi.fn(), remove = vi.fn()
      show({ primary: <Button variant="primary" onClick={open}>開く</Button>, secondary: <Button>結果</Button>, menuItems: [{ id: 'delete', label: '削除する', tone: 'danger', onSelect: remove }] })
      expect(identity.reads).toBe(0)
      const footer = document.querySelector('footer')!
      expect(within(footer).queryByRole('button', { name: '削除する' })).toBeNull()
      expect(within(footer).getAllByRole('button')).toHaveLength(3)
      fireEvent.click(screen.getByRole('button', { name: '開く' })); expect(open).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: '詳細のその他操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /削除する/ })); expect(remove).toHaveBeenCalledOnce()
      expect(screen.getByRole('heading', { name: '長い名前の全文' }).getAttribute('title')).toBe('長い名前の全文')
    })
    it('閲覧のみは移動先も実行口も残さず、焦点で理由が読める', () => {
      identity.role = 'viewer'; const run = vi.fn()
      show({ primary: <Button variant="primary" href="/write">編集</Button>, primaryAllowed: false, menuItems: [{ id: 'delete', label: '削除する', allowed: false, onSelect: run }] })
      expect(screen.queryByRole('link', { name: '編集' })).toBeNull()
      const button = screen.getByRole('button', { name: '編集' })
      expect(button.getAttribute('aria-disabled')).toBe('true'); fireEvent.focus(button)
      expect(screen.getAllByText(PERMISSION_LOCK_REASON.viewer).length).toBeGreaterThan(0)
      fireEvent.click(button)
      fireEvent.click(screen.getByRole('button', { name: '詳細のその他操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /削除する/ })); expect(run).not.toHaveBeenCalled()
    })
    it('本人未確認は理由なしの disabled、操作0では帯を作らない', () => {
      identity.role = null
      const result = show({ primary: <Button variant="primary" href="/write">編集</Button>, primaryAllowed: false })
      const button = screen.getByRole('button', { name: '編集' }) as HTMLButtonElement
      expect(button.disabled).toBe(true); expect(button.getAttribute('aria-describedby')).toBeNull()
      result.unmount(); show({ menuItems: [] }); expect(document.querySelector('footer')).toBeNull()
    })
  })
}

it('名前の編集中に権限が無くなっても入力は保ち、保存0・取消と再開はできる', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const view = render(<DetailInlineEdit allowed value="前の名前" label="名前" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
  const input = screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '編集中の名前' } })
  identity.role = 'viewer'; view.rerender(<DetailInlineEdit allowed={false} value="前の名前" label="名前" onSave={save} />)
  fireEvent.keyDown(input, { key: 'Enter' }); expect(save).not.toHaveBeenCalled(); expect(input.value).toBe('編集中の名前')
  identity.role = 'owner'; view.rerender(<DetailInlineEdit allowed value="前の名前" label="名前" onSave={save} />)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(save).toHaveBeenCalledExactlyOnceWith('編集中の名前')
})

it('数は実0・片側欠測・範囲を区別し、欠測に単位を付けない', () => {
  render(<><div data-case="zero"><DetailNumber value={0} unit="人" /></div><div data-case="missing"><DetailNumber value={null} unit="人" /></div><div data-case="invalid"><DetailNumber value={NaN} unit="人" /></div><div data-case="range"><DetailNumber range={{ from: 0, to: 1 }} unit="kg" /></div><div data-case="partial"><DetailNumber range={{ from: 0, to: null }} unit="kg" /></div></>)
  for (const [key, text] of Object.entries({ zero: '0 人', missing: '—', invalid: '—', range: '0 → 1 kg', partial: '—' })) expect(document.querySelector(`[data-case="${key}"]`)?.textContent).toBe(text)
})

it('指定のない引き出しは従来の補足段落を保ち、統一した面の省略文には全文を付ける', () => {
  const description = '長い補足文も読み取れる全文'
  const view = render(<Drawer open title="題" description={description} onClose={() => {}}>本文</Drawer>)
  expect(screen.getByText(description).tagName).toBe('P')
  view.rerender(<Drawer open title="題" description={description} actions={{}} onClose={() => {}}>本文</Drawer>)
  expect(screen.getByText(description).getAttribute('title')).toBe(description)
  view.rerender(<Drawer open title="長い題" dirty actions={{}} onClose={() => {}}>本文</Drawer>)
  expect(document.querySelector('[data-detail-title-text]')?.textContent).toBe('長い題')
  expect(screen.getByLabelText('未保存').closest('[data-detail-title-text]')).toBeNull()
})
