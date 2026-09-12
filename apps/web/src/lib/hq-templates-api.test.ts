import { beforeEach, describe, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ fetchApi: request }))
import { hqTemplatesApi } from './hq-templates-api'
beforeEach(() => { request.mockReset(); request.mockResolvedValue({ success: true, data: { value: 'ok' } }) })
describe('HQ template API transport', () => {
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
  it('失敗envelopeを成功にせず、内部のerror文字列を画面へ漏らさない', async () => {
    request.mockResolvedValue({ success: false, error: 'synthetic-private-detail', code: 'UNSUPPORTED' })
    await expect(hqTemplatesApi.list('form')).rejects.toThrow('未対応')
    request.mockRejectedValue(new Error('synthetic-private-detail')); await expect(hqTemplatesApi.list('tag')).rejects.toThrow('接続と入力内容')
  })
  it('権限不足と競合を安全な文言へ変換する', async () => {
    request.mockRejectedValue({ status: 403 }); await expect(hqTemplatesApi.get('t1')).rejects.toThrow('権限')
    request.mockRejectedValue({ status: 409 }); await expect(hqTemplatesApi.get('t1')).rejects.toThrow('更新されました')
  })
})
