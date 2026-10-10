import { describe, expect, it } from 'vitest'
// @ts-expect-error JS CLI
import { assertPublicBuild, verifyPublicBuild } from './verify-public-build.mjs'

const sha = 'a'.repeat(40)
describe('公開中の配備SHAの照合', () => {
  it('Workerのversionとhealth、管理画面の静的口をすべて読む', async () => {
    const paths: string[] = []
    await verifyPublicBuild('https://worker.test', sha, 'https://admin.test', sha, async (url: URL, options: RequestInit) => {
      paths.push(url.pathname)
      expect(options.cache).toBe('no-store')
      expect(options.headers).toBeUndefined()
      return Response.json(url.pathname === '/api/health'
        ? { success: true, data: { status: 'ok', git_commit: sha } } : { git_commit: sha })
    })
    expect(paths).toEqual(['/admin/version', '/api/health', '/version.json'])
  })
  it.each(['unknown', '', sha.slice(0, 12), 'b'.repeat(40), undefined])('配備run成功でもSHAが %s なら失敗する', value => {
    expect(() => assertPublicBuild({ git_commit: value }, sha, 'Worker')).toThrow(/一致しません/)
  })
  it('同じSHAを返すエラーページ・HTTP失敗も通さない', async () => {
    await expect(verifyPublicBuild('https://worker.test', sha, '-', '-', async (url: URL) => Response.json(
      url.pathname === '/api/health' ? { success: false, data: { git_commit: sha } } : { git_commit: sha },
    ))).rejects.toThrow(/health/)
    await expect(verifyPublicBuild('-', '-', 'https://admin.test', sha, async () => new Response('秘密の本文', { status: 403 }))).rejects.toThrow('HTTP 403')
  })
  it('設定再配備ではそれぞれの元SHAを別々に照合する', async () => {
    const adminSha = 'b'.repeat(40)
    await verifyPublicBuild('https://worker.test', sha, 'https://admin.test', adminSha, async (url: URL) => {
      const git_commit = url.hostname === 'admin.test' ? adminSha : sha
      return Response.json(url.pathname === '/api/health' ? { success: true, data: { status: 'ok', git_commit } } : { git_commit })
    })
  })
})
