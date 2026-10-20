import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import NotificationPanel from './notification-panel'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('V5 B4 オーバーレイ共通部品', () => {
  it('標準・重要操作ダイアログが確認中と失敗の状態を持つ', () => {
    const html = renderToStaticMarkup(<div>
      <Dialog open modal={false} title="保存しますか？" description="次回から反映します" onCancel={vi.fn()} onConfirm={vi.fn()} />
      <Dialog open modal={false} tone="destructive" title="統合しますか？" description="元に戻せません" busy error="確認できません" onCancel={vi.fn()} onConfirm={vi.fn()} />
    </div>)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('確認できません')
  })

  it('通知パネルは開・未読・フィルター・読込・失敗をpropsで受ける', () => {
    const html = renderToStaticMarkup(<NotificationPanel
      open inline unreadCount={1} activeFilter="all"
      filters={[{ id: 'all', label: 'すべて', count: 1 }]}
      items={[{ id: '1', title: '送信失敗', meta: '昨日 10:04', unread: true }]}
      onFilterChange={vi.fn()} onMarkAllRead={vi.fn()}
    />)
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
    const editor = readSource('components/friend-fields/tag-editor-v4.tsx') + readSource('v8/tag-edit/edit-form.tsx')
    const list = readSource('v8/tags/tags-tab.tsx')
    const actions = readSource('components/friend-fields/linked-action-list.tsx')
    expect(actions).toContain('ActionAddButton')
    expect(editor).toMatch(/import Notice/)
    expect(actions).toContain('params: { delayMinutes: 0, cancelIfTagRemoved: true }')
    expect(actions).toContain('newStepId()')
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

  it('ダイアログのボタンは最小幅を保ち、長いラベルを折り返さない', () => {
    // #976: 高さ・文字・色は共通Buttonへ委譲した。ここに残るのは幅の指定だけ。
    const css = read('dialog.module.css')
    expect(css).toMatch(/:root \.designButton \{[^}]*min-width: 0;/s)
    for (const className of ['designButton']) {
      expect(css).toMatch(new RegExp(`\\.${className} \\{[^}]*width: auto;[^}]*white-space: nowrap;`, 's'))
    }
  })
})
