import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
})

import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

/** 呼んだ先の道筋と問い合わせだけを見る（行き先の宿は設定ごとに違う）。 */
function pathOf(url: unknown): string {
  const parsed = new URL(String(url))
  return `${parsed.pathname}${parsed.search}`
}

describe('api.commonVars の一覧・削除・書き出しの口', () => {
  it('一覧・使用先・削除・CSVの依頼に、選択中のアカウントを付けて送る', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await api.commonVars.list('account/a')
    await api.commonVars.deleteImpact('var-1', 'account/a')
    await api.commonVars.delete('var-1', 'account/a', '整理のため')
    await api.commonVars.createExport({ accountId: 'account/a', folderId: null })

    expect(fetchSpy.mock.calls.map(([url]) => pathOf(url))).toEqual([
      '/api/common-vars?accountId=account%2Fa',
      '/api/common-vars/var-1/delete-impact?accountId=account%2Fa',
      '/api/common-vars/var-1?accountId=account%2Fa&reason=%E6%95%B4%E7%90%86%E3%81%AE%E3%81%9F%E3%82%81',
      '/api/common-vars/exports',
    ])
    expect(fetchSpy.mock.calls[2]?.[1]?.method).toBe('DELETE')
    expect(fetchSpy.mock.calls[3]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchSpy.mock.calls[3]?.[1]?.body))).toMatchObject({ accountId: 'account/a' })
  })
  it('作成と再生成の本人確認票をURLに入れずヘッダーで渡す', async () => {
    const fetchSpy = vi.fn(async (_input:RequestInfo|URL,_init?:RequestInit) => new Response(JSON.stringify({success:true,data:{}}),{status:200,headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',fetchSpy)
    await api.commonVars.createExport({accountId:'account/a',folderId:'folder-a'},'create-grant')
    await api.commonVars.regenerateExport('job/a','regenerate-grant')
    expect(fetchSpy.mock.calls.map(([url])=>pathOf(url))).toEqual(['/api/common-vars/exports','/api/common-vars/exports/job%2Fa/regenerate'])
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('X-Step-Up-Token')).toBe('create-grant')
    expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).get('X-Step-Up-Token')).toBe('regenerate-grant')
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({accountId:'account/a',folderId:'folder-a'})
    expect(fetchSpy.mock.calls[1][1]?.method).toBe('POST')
  })
})
