import { beforeEach, describe, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public readonly status: number, message?: string, public readonly code?: string) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return { request: vi.fn(), ApiError }
})
vi.mock('./api', () => ({ fetchApi: transport.request, ApiError: transport.ApiError }))
import { hqTemplatesApi, HqTemplatesApiError } from './hq-templates-api'
const request = transport.request
beforeEach(() => { request.mockReset(); request.mockResolvedValue({ success: true, data: { value: 'ok' } }) })
describe('HQ template API transport', () => {
  it('画像をJSON化せず認証・CSRF共通transportで送信する', async () => {
    const file = new File(['fixture'], '画像.png', { type: 'image/png' })
    await hqTemplatesApi.uploadImage(file, 'message')
    expect(request).toHaveBeenCalledWith('/api/hq/templates/media?purpose=message&filename=%E7%94%BB%E5%83%8F.png', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file })
    request.mockClear()
    await expect(hqTemplatesApi.uploadImage(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }), 'message')).rejects.toThrow('PNG・JPEG')
    expect(request).not.toHaveBeenCalled()
  })

  it('保存領域の所属先と利用者は認証済みAPIから取得する', async () => {
    request.mockResolvedValue({ success: true, data: { id: 'owner', tenantId: 'tenant-a', ignored: 'not-retained' } })
    expect(await hqTemplatesApi.context()).toEqual({ tenantId: 'tenant-a', actorId: 'owner' })
    expect(request).toHaveBeenCalledWith('/api/staff/me')
  })
  it.each([{ id: 'owner' }, { tenantId: 'tenant-a' }, { id: 'owner', tenantId: null }])('tenantまたは本人のIDが無いAPI応答は拒否する: %j', data => {
    request.mockResolvedValue({ success: true, data })
    return expect(hqTemplatesApi.context()).rejects.toThrow('所属先を確認できません')
  })
  it('認証とCSRFがある共通transportを利用し、成功envelopeを取り出す', async () => {
    expect(await hqTemplatesApi.list('tag')).toEqual({ value: 'ok' })
    expect(request).toHaveBeenCalledWith('/api/hq/templates?type=tag', { method: 'GET' })
    await hqTemplatesApi.accounts(); expect(request).toHaveBeenLastCalledWith('/api/hq/templates/accounts', { method: 'GET' })
  })
  it('識別子をパスとしてescapeし、確認と実行は別POSTにする', async () => {
    await hqTemplatesApi.preflight('t/1', ['a']); expect(request).toHaveBeenLastCalledWith('/api/hq/templates/t%2F1/preflight', { method: 'POST', body: '{"accountIds":["a"]}' })
    await hqTemplatesApi.distribute('t1', 'p1', [{ accountId: 'a', sourceId: 's1', mode: 'alias' }]); expect(request).toHaveBeenLastCalledWith('/api/hq/templates/t1/distribute', { method: 'POST', body: '{"preflightId":"p1","resolutions":[{"accountId":"a","sourceId":"s1","mode":"alias"}]}' })
    await hqTemplatesApi.result('t1', 'p/1'); expect(request).toHaveBeenLastCalledWith('/api/hq/templates/t1/distributions/p%2F1', { method: 'GET' })
  })
  it('削除には期待版を送る', async () => {
    await hqTemplatesApi.remove('t1', 8); expect(request).toHaveBeenLastCalledWith('/api/hq/templates/t1', { method: 'DELETE', body: '{"expectedRevision":8}' })
  })
  it('新規作成は同じrequestIdをbodyと冪等headerへ渡す', async () => {
    const input = { type: 'tag' as const, name: '来店済み', definition: { schemaVersion: 1 as const, tag: { name: '来店済み' }, folders: [] } }
    await hqTemplatesApi.create(input, 'request-123')
    expect(request).toHaveBeenLastCalledWith('/api/hq/templates', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'request-123' },
      body: JSON.stringify({ ...input, requestId: 'request-123' }),
    })
  })
  it('失敗envelopeを成功にせず、内部のerror文字列を画面へ漏らさない', async () => {
    request.mockResolvedValue({ success: false, error: 'synthetic-private-detail', code: 'UNSUPPORTED' })
    await expect(hqTemplatesApi.list('form')).rejects.toThrow('未対応')
    request.mockRejectedValue(new Error('synthetic-private-detail')); await expect(hqTemplatesApi.list('tag')).rejects.toThrow('接続と入力内容')
  })
  it('権限不足と競合を安全な文言へ変換する', async () => {
    request.mockRejectedValue(new transport.ApiError(403)); await expect(hqTemplatesApi.get('t1')).rejects.toThrow('権限')
    request.mockRejectedValue(new transport.ApiError(409, '最新版を読み込んでください。'))
    const conflict = await hqTemplatesApi.get('t1').catch(error => error)
    expect(conflict).toBeInstanceOf(HqTemplatesApiError)
    expect(conflict).toMatchObject({ status: 409, responseReceived: true })
    expect(conflict.message).toBe('最新版を読み込んでください。')
  })
  it.each([408, 429, 500, 502, 504])('HTTP %sを受信しても作成の未実行確定とは扱わない', async status => {
    request.mockRejectedValue(new transport.ApiError(status, 'gateway error'))
    const error = await hqTemplatesApi.create({ type: 'tag', name: '再確認', definition: { schemaVersion: 1, tag: { name: '再確認' }, folders: [] } }, 'same-request').catch(cause => cause)
    expect(error).toMatchObject({ status, responseReceived: true, requestNotApplied: false })
  })
  it.each([400, 401, 403, 409, 422, 428])('HTTP %sの明確な拒否を結果不明と区別する', async status => {
    request.mockRejectedValue(new transport.ApiError(status))
    const error = await hqTemplatesApi.get('t1').catch(cause => cause)
    expect(error).toMatchObject({ status, responseReceived: true, requestNotApplied: true })
  })
  it('HTTP応答自体が不明なら未実行とは断定しない', async () => {
    request.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await hqTemplatesApi.get('t1').catch(cause => cause)).toMatchObject({ responseReceived: false, requestNotApplied: false })
  })
  it('内部エラー本文は画面用エラーへ渡さない', async () => {
    request.mockRejectedValue(new transport.ApiError(500, 'D1_ERROR: SELECT secret FROM tenant'))
    const error = await hqTemplatesApi.get('t1').catch(cause => cause)
    expect(error.message).toContain('処理できませんでした')
    expect(error.message).not.toContain('D1_ERROR')
  })
})
