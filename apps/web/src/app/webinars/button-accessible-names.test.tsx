// @vitest-environment happy-dom
/*
 * Issue #637（監査 D-3「無名ボタン」10番 /webinars）の回帰固定。
 *
 * 監査では本文の空ボタンが記録された。一覧の行操作と、共用フォルダ欄
 * （FolderPanel）の行操作・追加操作のすべてが、可視テキストか
 * aria-label を持つことを固定する。FolderPanel は共有部品なので、
 * ここでは「呼び出し側が名付け操作を渡している」形を含めて検証する。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import FolderPanel from '@/components/shared/folder-panel'
import { buttonsWithoutAccessibleName } from '@/test-utils/accessible-name'
import type { WebinarListItem } from '@/lib/api'
import WebinarsPage from './page'

const { WebinarListContent } = WebinarsPage.__testing

const ITEM: WebinarListItem = {
  id: 'webinar-1',
  accountId: 'account-1',
  title: '入門ウェビナー',
  slug: 'intro',
  status: 'draft',
  videoPrefix: null,
  durationSeconds: 1_800,
  schedule: [],
  cta: null,
  tagOnAttend: null,
  tagOnCtaClick: null,
  folderId: null,
  folderName: null,
  registrationCount: 12,
  viewerCount: 8,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
}

function hostWith(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('Issue #637 /webinars 全ボタンにアクセシブルな名前', () => {
  it('一覧の行操作に無名ボタンがない', () => {
    const html = renderToStaticMarkup(
      <WebinarListContent
        accountLoading={false}
        loading={false}
        selectedAccountId="account-1"
        accountsCount={1}
        loadFailure={null}
        visibleItems={[ITEM]}
        panelGrand={1}
        refreshing={false}
        onRetry={vi.fn()}
        onArchive={vi.fn()}
      />,
    )
    const host = hostWith(html)
    expect(buttonsWithoutAccessibleName(host).map((b) => b.outerHTML.slice(0, 160))).toEqual([])
  })

  it('フォルダ欄の行操作・追加操作に無名ボタンがない', () => {
    const html = renderToStaticMarkup(
      <FolderPanel
        rows={[
          { id: 'all', label: 'すべて', count: 3 },
          {
            id: 'folder-1',
            label: '集客',
            count: 1,
            onEdit: vi.fn(),
            onMoveDown: vi.fn(),
            onDelete: vi.fn(),
            deleteNote: '削除しても、中のウェビナーは未分類に残ります。',
          },
          { id: 'folder-2', label: '顧客向け', count: 2, onEdit: vi.fn(), onMoveUp: vi.fn(), onDelete: vi.fn() },
        ]}
        activeId="all"
        onSelect={vi.fn()}
        total="3件"
        onAddFolder={vi.fn()}
      />,
    )
    const host = hostWith(html)
    expect(buttonsWithoutAccessibleName(host).map((b) => b.outerHTML.slice(0, 160))).toEqual([])
  })
})
