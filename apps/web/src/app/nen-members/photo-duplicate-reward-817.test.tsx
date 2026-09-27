// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoReviewDetail } from './photo-review-detail'
import { PhotoRewardPolicyCard } from './photo-reward-policy'

/*
 * #817: 写真の重複と報酬の決まりの版。主な状態を描画で確かめる。
 *
 * - 重複なし：帯は出さず、このまま採用が主役。
 * - 重複あり：帯と前の投稿の並びが出て、選べるのは却下か報酬なしで採用。
 *   主役の緑ボタンは1つだけ（報酬なしで採用）。
 * - 報酬の決まり：読み込み中・失敗・正常。
 */

vi.mock('next/link', () => ({ default: () => null }))

const VERSIONS = [
  {
    versionNumber: 2, policyKey: 'v2', points: 10, summary: '報酬を5pt→10ptに',
    effectiveFrom: null, createdBy: 'owner-1',
    createdAt: '2026-09-25T20:40:00+09:00', status: 'in_use',
  },
  {
    versionNumber: 1, policyKey: 'legacy-5', points: 5, summary: '最初の報酬の決まり',
    effectiveFrom: null, createdBy: null,
    createdAt: '2026-07-28T18:15:00+09:00', status: 'past',
  },
]

let policyMode: 'ok' | 'error' | 'pending' = 'ok'

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    if (path.startsWith('/api/nen-members/photo-reward-policy/versions')) {
      if (policyMode === 'error') {
        return new Response(JSON.stringify({ success: false, error: '読み込めません' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (policyMode === 'pending') {
        await new Promise(() => {})
      }
      return new Response(JSON.stringify({ success: true, data: VERSIONS }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`未設定: ${path}`)
  })
}

function basePhoto(): Record<string, unknown> {
  return {
    id: 'photo-new', pet_name: 'モカ', pet_call_name: 'モカちゃん', pet_gender: 'female',
    owner_name: '飼い主', caption: '', status: 'pending',
    image_url: 'https://img/photo-new.jpg', created_at: '2026-09-25T10:00:00+09:00',
    display_rotation: 0, image_width: 100, image_height: 100, image_byte_size: 100,
    risks: [], history: [], submission_count: 1, returned_count: 0,
  }
}

const noop = () => {}
const asyncNoop = async () => {}

async function renderDetail(photo: Record<string, unknown>, host: HTMLDivElement) {
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <PhotoReviewDetail
        photo={photo}
        position={0}
        total={1}
        loading={false}
        loadKind="ready"
        reviewing={false}
        notice=""
        accountNotice=""
        assetStatus={null}
        derivatives={null}
        assetsFailed={false}
        onReloadAssets={noop}
        assetProcessing={false}
        rotationSaving={false}
        onBack={noop}
        onMove={noop}
        onApprove={noop}
        onReturn={noop}
        onAdoptWithoutReward={noop}
        onProcessReviewAsset={noop}
        onSaveRotation={noop}
        onDownloadOriginal={asyncNoop}
        onPointAction={noop}
        pointActionBusy={null}
      />,
    )
  })
  return root
}

let host: HTMLDivElement

beforeEach(() => {
  policyMode = 'ok'
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(async () => {
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('#817 重複の表示', () => {
  it('重複なし：帯は出さず、このまま採用が主役', async () => {
    const root = await renderDetail(basePhoto(), host)
    expect(host.textContent).not.toContain('すでに採用されています')
    expect(host.textContent).toContain('このまま採用')
    expect(host.textContent).not.toContain('報酬なしで採用')
    await act(async () => { root.unmount() })
  })

  it('重複あり：帯と前の投稿の並びが出て、主役は報酬なしで採用だけ', async () => {
    const root = await renderDetail({
      ...basePhoto(),
      duplicate: {
        photoId: 'photo-old', imageUrl: 'https://img/photo-old.jpg',
        petName: 'モカ', createdAt: '2026-08-12T10:00:00+09:00', awardedPoints: 5,
      },
    }, host)
    expect(host.textContent).toContain('同じ写真がすでに採用されています')
    expect(host.textContent).toContain('今回の投稿')
    expect(host.textContent).toContain('前の投稿（採用済み）')
    expect(host.textContent).toContain('却下する')
    expect(host.textContent).toContain('報酬なしで採用')
    expect(host.textContent).not.toContain('このまま採用')
    await act(async () => { root.unmount() })
  })
})

describe('#817 報酬の決まりの小箱', () => {
  it('正常：いま使っている版の点数と履歴の入り口が出る', async () => {
    const root = createRoot(host)
    await act(async () => {
      root.render(<PhotoRewardPolicyCard />)
    })
    expect(host.textContent).toContain('報酬の決まり')
    expect(host.textContent).toContain('10マイル')
    expect(host.textContent).toContain('第2版')
    expect(host.textContent).toContain('版の履歴を見る')
    await act(async () => { root.unmount() })
  })

  it('失敗：件数は「—」で、読み直しの入り口が出る', async () => {
    policyMode = 'error'
    const root = createRoot(host)
    await act(async () => {
      root.render(<PhotoRewardPolicyCard />)
    })
    expect(host.textContent).toContain('報酬の決まり')
    expect(host.textContent).toContain('—')
    expect(host.textContent).toContain('もう一度読み込む')
    expect(host.textContent).not.toContain('版の履歴を見る')
    await act(async () => { root.unmount() })
  })
})
