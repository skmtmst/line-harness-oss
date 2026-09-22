// @vitest-environment happy-dom
/*
 * TECH-03: Cookie が使えない認証経路でも CSV を出せることの回帰試験。
 *
 * `<a href>` で API の URL を直開きすると Cookie にしか頼れず、
 * cross-site で Cookie が止められる構成（Bearer 補完経路）では
 * 401 になってファイルが出ない。downloadApiFile は fetchApi と同じ
 * 資格情報（Cookie + Authorization: Bearer lh_session:…）で取り、
 * Blob から保存する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const API_BASE = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
  return process.env.NEXT_PUBLIC_API_URL
})

let bookingApi: typeof import('./api').bookingApi
let eventsApi: typeof import('./api').eventsApi
let downloadApiFile: typeof import('./api').downloadApiFile
let ApiError: typeof import('./api').ApiError
let storeAdminSession: typeof import('./admin-session').storeAdminSession
let clearAdminSession: typeof import('./admin-session').clearAdminSession

let clicked: Array<{ href: string; download: string }>
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  ;({ bookingApi, eventsApi, downloadApiFile, ApiError } = await import('./api'))
  ;({ storeAdminSession, clearAdminSession } = await import('./admin-session'))
  clicked = []
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download })
    })
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => 'blob:fake-csv',
    revokeObjectURL: () => undefined,
  }))
  clearAdminSession()
})

afterEach(() => {
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearAdminSession()
})

const csvResponse = () =>
  new Response('\uFEFF予約ID,お客さま名\r\nb1,山田\r\n', {
    status: 200,
    // タプルで渡す（オブジェクトのキーとして書くと worker の
    // CORS 許可ヘッダ契約試験がリクエストヘッダと誤認して拾う）。
    headers: new Headers([
      ['content-type', 'text/csv; charset=utf-8'],
      ['Content-Disposition', 'attachment; filename="booking-ledger-20260922.csv"'],
    ]),
  })

describe('downloadApiFile（TECH-03）', () => {
  it('Bearer 補完セッションを付けて取り、サーバーのファイル名で保存する', async () => {
    storeAdminSession('session-token-1')
    const fetchSpy = vi.fn(async () => csvResponse())
    vi.stubGlobal('fetch', fetchSpy)

    await bookingApi.downloadLedgerCsv('acc-1', { status: 'confirmed', staffId: 'staff-9' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/booking/admin/bookings.csv?account_id=acc-1&status=confirmed&staff_id=staff-9`)
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lh_session:session-token-1')
    // Cookie に頼る画面遷移ではなく、取得した Blob を保存する。
    expect(clicked).toEqual([{ href: 'blob:fake-csv', download: 'booking-ledger-20260922.csv' }])
  })

  it('イベント申込者CSVも同じく認証付き取得で取る', async () => {
    storeAdminSession('session-token-2')
    const fetchSpy = vi.fn(async () => csvResponse())
    vi.stubGlobal('fetch', fetchSpy)

    await eventsApi.downloadOccurrenceApplicantsCsv('acc-1', 'occ-1', 'snap-1')

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/events/admin/occurrences/occ-1/applicants.csv?snapshot_id=snap-1&account_id=acc-1`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lh_session:session-token-2')
    expect(clicked).toHaveLength(1)
  })

  it('401はファイル成功にせず ApiError として投げ、保存しない', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: 'unauthorized' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(downloadApiFile('/api/booking/admin/bookings.csv?account_id=acc-1', 'booking-ledger.csv'))
      .rejects.toBeInstanceOf(ApiError)
    expect(clicked).toHaveLength(0)
  })

  it('403（権限不足・期限切れ）も保存せず ApiError になる', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: 'permission_denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(downloadApiFile('/api/booking/admin/bookings.csv?account_id=acc-1', 'booking-ledger.csv'))
      .rejects.toMatchObject({ status: 403 })
    expect(clicked).toHaveLength(0)
  })
})
