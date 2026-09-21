// @vitest-environment happy-dom
/*
 * IDEA-31: 「はじめの設定」の初期セット選択の動作を、実際に描画した
 * コンポーネントで確認する。
 * - 保存済みの設定がある（version > 0）ときは picker を出さない
 * - 適用は features と版と理由だけを送り、メニューの並びは送らない
 * - 権限が無い人には picker を出さない
 * - 動いている処理があるときはこの画面では適用せず機能設定へ誘導する
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_IDS } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))
const network = vi.hoisted(() => ({
  getStatus: 200,
  version: 0,
  saveStatus: 200,
  saveBody: null as Record<string, unknown> | null,
  puts: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { FeatureSetCard } = await import('./feature-set-card')

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let host: HTMLDivElement
let root: Root
let mounted = false

beforeEach(() => {
  fixture.accountId = 'account-a'
  network.getStatus = 200
  network.version = 0
  network.saveStatus = 200
  network.puts = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/api/settings/features')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        network.puts.push(body)
        if (network.saveStatus === 409) {
          return response(
            {
              success: false,
              error: 'オフにしようとしている機能に、公開中・予約中・依存中のものがあります。',
              code: 'IMPACT_CONFIRMATION_REQUIRED',
              data: { impacts: [], currentVersion: 0 },
            },
            409,
          )
        }
        return response({ success: true, data: { version: 1 } })
      }
      if (network.getStatus === 403) {
        return response(
          { success: false, error: 'Forbidden', code: 'FEATURE_SETTINGS_SCOPE_FORBIDDEN' },
          403,
        )
      }
      return response({
        success: true,
        data: {
          features: Object.fromEntries(FEATURE_IDS.map((id) => [id, true])),
          sidebarItemOrder: { delivery: ['scenarios', 'broadcasts'] },
          specializedFeatureKeys: [],
          version: network.version,
        },
      })
    }
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<FeatureSetCard accountId={fixture.accountId} />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

function radios(): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
}

function applyButton(): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === 'このセットで始める',
  )
  if (!found) throw new Error('適用ボタンが見つかりません')
  return found
}

describe('IDEA-31 使う機能の初期セット', () => {
  it('まだ保存していないアカウントには3つのセットを選ぶ口を出す', async () => {
    await render()
    await act(async () => { await settle() })
    expect(radios()).toHaveLength(3)
    expect(host.textContent).toContain('まず必要なものだけ')
    expect(host.textContent).toContain('予約・来店・イベント業務がある')
    expect(host.textContent).toContain('全部の機能を使う')
    // 非表示と実行停止の違い・緊急停止の行き先を説明する
    expect(host.textContent).toContain('止まりません')
    expect(host.textContent).toContain('運用状態')
  })

  it('適用は features と版と理由だけを送り、メニューの並び・区分順は送らない', async () => {
    await render()
    await act(async () => { await settle() })
    await act(async () => { applyButton().click(); await settle(); await settle() })
    expect(network.puts).toHaveLength(1)
    const body = network.puts[0]
    expect(body.expectedVersion).toBe(0)
    expect(typeof body.reason).toBe('string')
    expect(body.reason).toContain('まず必要なものだけ')
    // メニューの並び順・区分の順・名前をリセットしない（送らない＝既存値が残る）
    expect('sidebarItemOrder' in body).toBe(false)
    expect('sidebarOrder' in body).toBe(false)
    const features = body.features as Record<string, boolean>
    // starter では順路に必要な機能が残り、予約系はオフになる
    expect(features.scenarios).toBe(true)
    expect(features.friend_add_routing).toBe(true)
    expect(features.booking).toBe(false)
    expect(host.textContent).toContain('適用しました')
  })

  it('保存済みの設定がある（version > 0）ときは picker を出さず上書きしない', async () => {
    network.version = 5
    await render()
    await act(async () => { await settle() })
    expect(radios()).toHaveLength(0)
    expect(host.textContent).toContain('すでに保存されています')
    expect(host.textContent).toContain('機能設定')
    expect(network.puts).toHaveLength(0)
  })

  it('権限が無い人には picker を出さず、管理者が行う旨だけを出す', async () => {
    network.getStatus = 403
    await render()
    await act(async () => { await settle() })
    expect(radios()).toHaveLength(0)
    expect(host.textContent).toContain('オーナーか管理者')
  })

  it('動いている処理があるときは適用せず、機能設定での確認へ誘導する', async () => {
    network.saveStatus = 409
    await render()
    await act(async () => { await settle() })
    await act(async () => { applyButton().click(); await settle(); await settle() })
    expect(network.puts).toHaveLength(1)
    expect(host.textContent).toContain('この画面では適用できません')
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull()
    // 失敗後も picker は残り、選び直せる
    expect(radios()).toHaveLength(3)
  })
})
