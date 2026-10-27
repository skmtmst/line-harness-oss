// @vitest-environment happy-dom
/*
 * ★V8 外部連携「送り先を作る」で、送る出来事を選ぶ動き。
 * 「すべて送る」か「選んだものだけ送る」の2択と、出来事ごとのチェックで選び、
 * 作る口へは正本の種類コード（すべては *、受け取りの種類は incoming_webhook.<種類>）を送る。
 * 見本から ?event= で来たら、その出来事だけを選んでおく。知らない値は全部へ丸めない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EC_EVENT_TYPES, ecEventLabel } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({ create: vi.fn(), me: vi.fn(), push: vi.fn(), search: '' }))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: fixture.push }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(), usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { staff: { me: fixture.me }, webhooks: { outgoing: { create: fixture.create } } } }
})

import WebhooksCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.search = ''
  fixture.push.mockReset()
  fixture.create.mockReset()
  fixture.create.mockResolvedValue({ success: true, data: { id: 'wh-new-1' } })
  fixture.me.mockReset()
  fixture.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<WebhooksCreateV8 />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const checkbox = (label: string) => [...host.querySelectorAll('label')].find((node) => node.textContent?.trim() === label)?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined
const checkedLabels = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((input) => input.checked).map((input) => input.closest('label')?.textContent?.trim())
const button = (text: string) => [...host.querySelectorAll('button, a')].find((node) => node.textContent?.trim() === text) as HTMLElement

async function fillDestination() {
  await act(async () => {
    fireEvent.change(host.querySelector('#wh-new-name')!, { target: { value: '外部CRM連携' } })
    fireEvent.change(host.querySelector('#wh-new-url')!, { target: { value: 'https://example.com/hook' } })
  })
}
async function openDetails() {
  await act(async () => { button('詳細条件').click() })
}
async function save() {
  await act(async () => { button('つくって動かす').click() })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const sentEventTypes = () => (fixture.create.mock.calls[0]?.[0] as { eventTypes: string[] } | undefined)?.eventTypes

describe('送る出来事の選び方', () => {
  it('「すべて送る」と「選んだものだけ送る」の2択で、選ぶ側は共通のチェックで選ぶ', async () => {
    await render()
    const modes = [...host.querySelectorAll<HTMLInputElement>('input[name="wh-new-mode"]')]
    expect(modes.map((input) => [input.value, input.type, input.closest('label')?.textContent?.trim()])).toEqual([
      ['all', 'radio', 'すべて送る'],
      ['selected', 'radio', '選んだものだけ送る'],
    ])
    for (const label of ['友だちになった', '友だちを解除された', 'タグが付いた', '問い合わせが来た', '予約が入った', '注文が確定した', '発送した']) {
      expect(checkbox(label), label).toBeTruthy()
    }
    // 「すべて送る」にするとチェックは要らないので消える。
    await act(async () => { modes[0].click() })
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('チェックした出来事は正本の種類コードで送る（EC の出来事は共有の正本から並べる）', async () => {
    await render()
    await fillDestination()
    await openDetails()
    const codes: Record<string, string> = {
      友だちになった: 'friend_add', 友だちを解除された: 'friend_unfollow', タグが付いた: 'tag_change',
      問い合わせが来た: 'message_received', 予約が入った: 'booking_created',
      フォームが送られた: 'form_submitted', ボタンが押された: 'postback_received', 担当が決まった: 'staff_assigned',
      個別に返信した: 'manual_reply_sent', 成果地点が起きた: 'cv_fire',
    }
    const ecOthers = EC_EVENT_TYPES.filter((value) => value !== 'ec.order.confirmed' && value !== 'ec.order.shipped')
    expect(ecOthers.length).toBeGreaterThan(0)
    for (const label of [...Object.keys(codes), ...ecOthers.map((value) => ecEventLabel(value))]) {
      await act(async () => { checkbox(label)!.click() })
    }
    await save()
    expect(fixture.create).toHaveBeenCalledTimes(1)
    expect(sentEventTypes()).toEqual([...Object.values(codes), ...ecOthers])
  })

  it('「すべて送る」は * として送る', async () => {
    await render()
    await fillDestination()
    await act(async () => { (host.querySelector('input[name="wh-new-mode"][value="all"]') as HTMLInputElement).click() })
    await save()
    expect(sentEventTypes()).toEqual(['*'])
  })

  it('受け取った知らせの種類は詳細条件に置き、incoming_webhook.<種類> として送る', async () => {
    await render()
    await fillDestination()
    expect(host.querySelector('#wh-new-incoming')).toBeNull()
    await openDetails()
    await act(async () => { fireEvent.change(host.querySelector('#wh-new-incoming')!, { target: { value: 'form, booking' } }) })
    await save()
    expect(sentEventTypes()).toEqual(['incoming_webhook.form', 'incoming_webhook.booking'])
  })

  it('何も選ばずに作ろうとすると送らず、選ぶよう欄で知らせる', async () => {
    await render()
    await fillDestination()
    await save()
    expect(fixture.create).not.toHaveBeenCalled()
    expect(host.querySelector('#wh-new-events-error')?.textContent).toBe('送るものを選ぶか、「すべて送る」を選んでください')
    expect(host.querySelector('#wh-new-events')?.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('見本の ?event= で来たとき', () => {
  it('知っている出来事はそれだけを選んでおく', async () => {
    fixture.search = 'event=booking_created'
    await render()
    expect((host.querySelector('input[name="wh-new-mode"][value="selected"]') as HTMLInputElement).checked).toBe(true)
    expect(checkedLabels()).toEqual(['予約が入った'])
  })

  it('知らない値は「すべて送る」へ丸めず、何も選ばない', async () => {
    fixture.search = 'event=unknown_event'
    await render()
    expect((host.querySelector('input[name="wh-new-mode"][value="all"]') as HTMLInputElement).checked).toBe(false)
    expect(checkedLabels()).toEqual([])
    await fillDestination()
    await save()
    expect(fixture.create).not.toHaveBeenCalled()
  })
})

describe('作ったあとの戻り先', () => {
  it('キャンセルは一覧へ、作ったら作った送り先の印を持って一覧へ戻る', async () => {
    await render()
    expect(button('キャンセル').getAttribute('href')).toBe('/webhooks')
    await fillDestination()
    await act(async () => { (host.querySelector('input[name="wh-new-mode"][value="all"]') as HTMLInputElement).click() })
    await save()
    expect(fixture.push).toHaveBeenCalledWith('/webhooks?highlight=wh-new-1')
  })
})
