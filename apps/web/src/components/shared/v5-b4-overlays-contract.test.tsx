import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ActionMenu from './action-menu'
import Dialog from './dialog'
import Drawer from './drawer'
import Notice from './notice'
import NotificationPanel from './notification-panel'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const WEB = join(SRC, '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('V5 B4 オーバーレイ共通部品', () => {
  it('標準・重要操作ダイアログがPencil Node IDと状態を持つ', () => {
    const html = renderToStaticMarkup(<div>
      <Dialog open modal={false} title="保存しますか？" description="次回から反映します" onCancel={vi.fn()} onConfirm={vi.fn()} />
      <Dialog open modal={false} tone="destructive" title="統合しますか？" description="元に戻せません" busy error="確認できません" onCancel={vi.fn()} onConfirm={vi.fn()} />
    </div>)
    expect(html).toContain('data-design-node="J6x4Q"')
    expect(html).toContain('data-design-node="H2S1T4"')
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('確認できません')
  })

  it('右詳細・3通知・操作メニューを同じAPIで表せる', () => {
    const html = renderToStaticMarkup(<div>
      <Drawer open modal={false} title="友だち詳細" details={[{ label: '担当', value: '未設定' }]} onClose={vi.fn()} />
      <Notice tone="success" message="保存しました" onClose={vi.fn()} />
      <Notice tone="validation" message="入力内容を確認してください" />
      <Notice tone="error" message="処理に失敗しました" />
      <ActionMenu open inline onClose={vi.fn()} items={[{ id: 'delete', label: '削除', tone: 'danger', onSelect: vi.fn() }]} />
    </div>)
    for (const nodeId of ['VJKAT', 'ApbSZ', 'zPRvi', 'I5rKbM', 'hGpFq']) expect(html).toContain(`data-design-node="${nodeId}"`)
    expect(html).toContain('aria-label="通知を閉じる"')
    expect(html).toContain('role="menuitem"')
  })

  it('通知パネルは開・未読・フィルター・読込・失敗をpropsで受ける', () => {
    const html = renderToStaticMarkup(<NotificationPanel
      open inline unreadCount={1} activeFilter="all"
      filters={[{ id: 'all', label: 'すべて', count: 1 }]}
      items={[{ id: '1', title: '送信失敗', meta: '昨日 10:04', unread: true }]}
      onFilterChange={vi.fn()} onMarkAllRead={vi.fn()}
    />)
    expect(html).toContain('data-design-node="z6TmF"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('未読')
    expect(html).toContain('送信失敗')
    const unavailable = renderToStaticMarkup(<NotificationPanel
      open inline unreadCount={0} activeFilter="all"
      filters={[{ id: 'all', label: 'すべて', count: null }]}
      items={[]}
      error="通知を読み込めませんでした"
      onFilterChange={vi.fn()} onMarkAllRead={vi.fn()}
    />)
    expect(unavailable).toContain('>—<')
    expect(unavailable).toContain('通知を読み込めませんでした')
  })

  it('代表画面は共通部品を使い、既存の保存・削除・追加処理を残す', () => {
    const editor = readSource('components/friend-fields/tag-editor-v4.tsx')
    const list = readSource('components/friend-fields/tags-page-v4.tsx')
    expect(editor).toMatch(/import Drawer/)
    expect(editor).toMatch(/import Notice/)
    expect(editor).toContain('onAdd({ id: crypto.randomUUID()')
    expect(list).toMatch(/import ActionMenu/)
    expect(list).toMatch(/import ConfirmDialog/)
    expect(list).toContain('api.tagGroups.delete')
    expect(list).toContain('api.tagGroups.update')
  })

  it('CSSモジュールは生の色とローカル変数を持たず、フォーカスを消さない', () => {
    for (const name of ['dialog.module.css', 'drawer.module.css', 'notice.module.css', 'action-menu.module.css', 'notification-panel.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
      expect(css, `${name} がfocus-visibleを保証していない`).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*revert;/s)
    }
  })

  it('契約はB4の部品・実ノード・宣言数を固定する', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const inventory = JSON.parse(readFileSync(join(WEB, 'design', 'pencil-component-inventory.json'), 'utf8'))
    // 2026-09-03: 色と角丸を1系統にまとめ、同値の別名3つ
    // （--radius-tile / --color-status-warning / --color-status-warning-soft）
    // を消したので 24 → 21。承認は docs/v6-directives.md §4。
    expect(contract.required.tokens).toBe(21)
    expect(contract.required.parts).toBe(20)
    expect(contract.required.partDeclarations).toBe(301)
    expect(contract.parts.dialog.pencilNodes).toEqual(['J6x4Q', 'H2S1T4'])
    expect(contract.parts.drawer.pencilNodes).toEqual(['VJKAT'])
    expect(contract.parts.notice.pencilNodes).toEqual(['ApbSZ', 'zPRvi', 'I5rKbM'])
    expect(contract.parts['action-menu'].pencilNodes).toEqual(['hGpFq'])
    expect(contract.parts['notification-panel'].status).toBe('implemented')
    for (const nodeId of ['J6x4Q', 'H2S1T4', 'VJKAT', 'ApbSZ', 'zPRvi', 'I5rKbM', 'hGpFq']) expect(inventory.components[nodeId].status).toBe('active')
    expect(inventory.components.z6TmF.status).toBe('implemented')
  })
})
