// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lh_csrf' ? 'test-session' : null })
})
afterEach(() => vi.unstubAllGlobals())

function response() {
  return new Response(JSON.stringify({ success: true, data: { plan: { label: '無料' } } }), { status: 200 })
}

describe('同時に出る請求表示の読み込み', () => {
  it('セッションを判別できないときは取得を共有しない', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([api.hqBilling.summary(), api.hqBilling.summary()])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('同時の取得は1回、完了後の再読み込みは最新を取得し、表示用の加工も共有しない', async () => {
    let answer!: (res: Response) => void
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve }))
      .mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetch)
    const first = api.hqBilling.summary()
    const second = api.hqBilling.summary()
    expect(fetch).toHaveBeenCalledTimes(1)
    answer(response())
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(a.data).not.toBe(b.data)
    await api.hqBilling.summary()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('失敗を残さず、次の取得で復旧できる', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":"取得失敗"}', { status: 403 }))
      .mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetch)
    const failed = await Promise.allSettled([api.hqBilling.summary(), api.hqBilling.summary()])
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(api.hqBilling.summary()).resolves.toMatchObject({ success: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('セッションが変わった取得は共有しない', async () => {
    let csrf = 'session-a'
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lh_csrf' ? csrf : null })
    const answers: Array<(res: Response) => void> = []
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { answers.push(resolve) }))
    vi.stubGlobal('fetch', fetch)
    const first = api.hqBilling.summary()
    csrf = 'session-b'
    const second = api.hqBilling.summary()
    expect(fetch).toHaveBeenCalledTimes(2)
    answers.forEach((answer) => answer(response()))
    await Promise.all([first, second])
  })

  it('同じCSRFでも管理セッションが変わった取得は共有しない', async () => {
    let token = 'admin-session-a'
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => key === 'lh_admin_session_fallback' ? token : null })
    const answers: Array<(res: Response) => void> = []
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { answers.push(resolve) }))
    vi.stubGlobal('fetch', fetch)
    const first = api.hqBilling.summary()
    token = 'admin-session-b'
    const second = api.hqBilling.summary()
    expect(fetch).toHaveBeenCalledTimes(2)
    answers.forEach((answer) => answer(response()))
    await Promise.all([first, second])
  })
})
