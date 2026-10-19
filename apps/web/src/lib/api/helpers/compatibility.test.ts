import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchApi } from '../../api'
import { ApiError as TransportError, fetchApi as transportRequest } from '../transport'
import { bookingAdvancedApi } from './booking-advanced'
import { gap3BookingApi } from './gap3'
import { gapDraftApi } from './gap-draft'
import { bookingPartyApi, seriesImpactApi } from './gap2-pending'
import { styleSetupApi } from './style-setup'
import { styleApi } from './styles'
import { bookingPaymentAdminApi } from './booking-payment-admin'

afterEach(() => vi.unstubAllGlobals())

describe('通信の公開口と機能別口の互換', () => {
  it('同じ通信・エラー・初期設定を参照し、エラーのinstanceofを保つ', () => {
    expect(fetchApi).toBe(transportRequest)
    expect(new TransportError(409)).toBeInstanceOf(ApiError)
    expect(styleSetupApi).toBe(styleApi)
    expect(gap3BookingApi.depositRule).toBe(bookingAdvancedApi.depositRule)
    expect(gapDraftApi.depositRule).toBe(bookingAdvancedApi.depositRule)
    expect(gapDraftApi.bookingGroup).toBe(bookingPartyApi.get)
    expect(seriesImpactApi.impact).toBe(bookingAdvancedApi.impact)
  })

  it('旧読込口も店・予約・版と本文を同じ実在する口へ渡す', async () => {
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => Response.json({ success: true, data: {} }))
    vi.stubGlobal('fetch', request)
    await gapDraftApi.depositRule('店/a &b')
    await gapDraftApi.cancelGroup('店/a &b', 'booking/a', '同伴者の都合')
    await seriesImpactApi.impact('店/a &b', 'series/a', { scope: 'following', fromBookingId: 'booking/a', change: { startsAt: '2026-11-01T09:00:00Z' } })
    expect(request.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, new URL(String(url)).searchParams.get('account_id'), init?.method ?? 'GET', init?.body])).toEqual([
      ['/api/booking/admin/deposit-rules', '店/a &b', 'GET', undefined],
      ['/api/booking/admin/bookings/booking%2Fa/group/cancel', '店/a &b', 'POST', JSON.stringify({ reason: '同伴者の都合' })],
      ['/api/booking/admin/series/series%2Fa/impact', '店/a &b', 'POST', JSON.stringify({ scope: 'following', fromBookingId: 'booking/a', change: { startsAt: '2026-11-01T09:00:00Z' } })],
    ])
  })

  it('模擬リンクの送信なしと409を保持し、結果を自動再送しない', async () => {
    const result = { success: true, data: { paymentId: 'payment/a', checkoutUrl: null, simulation: true, sent: false } }
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ error: 'automatic_charge_not_available' }, { status: 409 }))
    vi.stubGlobal('fetch', request)
    await expect(bookingPaymentAdminApi.previewPaymentLink('account/a', 'payment/a')).resolves.toEqual(result)
    expect(request.mock.calls[0][1]?.body).toBe(JSON.stringify({ dryRun: true }))
    await expect(gapDraftApi.saveCancellationOptions('account/a', { cardRequiredFor: 'all', chargeMode: 'auto', expectedVersion: 2 })).rejects.toMatchObject({ status: 409, code: 'automatic_charge_not_available' })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
