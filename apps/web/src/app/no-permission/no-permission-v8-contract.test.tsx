// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import NoPermissionV8 from './no-permission-v8'

// happy-dom では import.meta.url が file 形にならないため、作業場所からの相対で読む。
const BOARD = readFileSync('src/app/no-permission/no-permission-v8.tsx', 'utf8')
const VARS_V8 = readFileSync('src/app/contents/vars/list-v8.tsx', 'utf8')

/*
 * ★V8 権限なし（板 `O5tUeE`）の契約。
 * API が 403 を返したときに出す共通の板。V8 のときだけ呼ぶ。
 * 役割の仕組みは作らない——渡された表示名だけを出し、
 * 知らない欄は出さない。無い画面へ送る口は置かない。
 */
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

async function renderBoard(props: React.ComponentProps<typeof NoPermissionV8>) {
  await act(async () => {
    root?.render(<NoPermissionV8 {...props} />)
  })
}

describe('V8 権限なし（O5tUeE）の板', () => {
  test('見本どおりの文言と戻る口が出る', async () => {
    await renderBoard({
      featureName: 'シナリオ配信',
      roleLabel: '受付',
      requiredRoleLabel: '運用',
      adminName: 'Kenta Kawano',
      capabilitiesHref: '/staff',
    })
    expect(host?.querySelector('[data-design-node="O5tUeE"]')).not.toBeNull()
    expect(host?.textContent).toContain('シナリオ配信')
    expect(host?.textContent).toContain('この機能は、あなたの役割では開けません。')
    expect(host?.textContent).toContain('シナリオ配信を開く権限がありません')
    expect(host?.textContent).toContain('いまの役割は「受付」です。')
    expect(host?.textContent).toContain('シナリオ配信は「運用」以上の役割で使えます。')
    expect(host?.textContent).toContain('必要なら、管理者に役割の変更を頼んでください。')
    expect(host?.textContent).toContain('管理者：Kenta Kawano')
    expect(host?.textContent).toContain('役割でできることを見る')
    expect(host?.textContent).toContain('ダッシュボードへ戻る')
  })

  test('知らない欄は出さず、断定しない', async () => {
    await renderBoard({ featureName: '共通情報' })
    expect(host?.textContent).toContain('この画面を開く権限がありません。')
    expect(host?.textContent).not.toContain('いまの役割は「')
    expect(host?.textContent).not.toContain('以上の役割で使えます')
    expect(host?.textContent).not.toContain('管理者：')
    expect(host?.textContent).not.toContain('役割でできることを見る')
    // 戻る口だけは残す。
    expect(host?.textContent).toContain('ダッシュボードへ戻る')
  })

  test('画面の中へ戻るときは押したときの動きになる', async () => {
    const onBack = vi.fn()
    await renderBoard({ featureName: '登録メディア', backLabel: '登録メディア一覧へ戻る', onBack })
    const button = Array.from(host?.querySelectorAll('button') ?? [])
      .find((item) => item.textContent === '登録メディア一覧へ戻る')
    expect(button).toBeTruthy()
    button?.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('V8 権限なし（O5tUeE）の受け口', () => {
  test('共通の板として作り、V8 の 403 枝で出す', () => {
    expect(BOARD).toContain('data-design-node="O5tUeE"')
    expect(BOARD).not.toContain('準備中')
    expect(BOARD).not.toContain('取得できません')
    // 役割の仕組みは作らない。表示名を受け取るだけ。
    expect(BOARD).toContain('roleLabel?: string | null')
    expect(VARS_V8).toContain('<NoPermissionV8')
    expect(VARS_V8).toContain('featureName="共通情報"')
  })

  test('V8 の全画面403で共通の板を出す', () => {
    // 全画面の 403 枝はこの板で出す。埋め込みの失敗文（保存・切替・行内）は対象外。
    const receivers = [
      'src/app/auto-replies/list-v8.tsx',
      'src/app/auto-replies/edit/wizard-v8.tsx',
      'src/app/booking/menus/new/menu-form-v8.tsx',
      'src/app/booking/staff/new/staff-new-v8.tsx',
      'src/app/broadcasts/list-v8.tsx',
      'src/app/contents/vars/list-v8.tsx',
      'src/app/events/events-list-v8.tsx',
      'src/app/form-submissions/list-v8.tsx',
      'src/app/friend-add-settings/runs/detail/detail-v8.tsx',
      'src/app/friends/migrations/migrations-v8.tsx',
      'src/app/hq/banners/project/page.tsx',
      'src/app/hq/billing/page.tsx',
      'src/app/hq/members/page.tsx',
      'src/app/nen/members/members-v8.tsx',
      'src/app/settings/file-scan/file-scan-v8.tsx',
      'src/app/settings/manual-links/manual-links-v8.tsx',
      'src/app/tags/field-migrate-v8.tsx',
      'src/app/tags/fields-tab-v8.tsx',
      'src/app/tags/mark-editor-v8.tsx',
      'src/app/tags/marks-v8.tsx',
      'src/app/tags/searches-v8.tsx',
      'src/app/tags/tags-tab-v8.tsx',
      'src/app/templates/list-v8.tsx',
      'src/app/webhooks/apitokens-v8.tsx',
      'src/app/webinars/list-v8.tsx',
    ]
    for (const receiver of receivers) {
      const source = readFileSync(receiver, 'utf8')
      expect(source, receiver).toContain('<NoPermissionV8')
    }
  })
})
