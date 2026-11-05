import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error JS CLI
import { assertStagingForward, readStagingRevisions } from './verify-staging-forward.mjs'

describe('共有検証環境の巻き戻し防止', () => {
  const repo = mkdtempSync(resolve(tmpdir(), 'staging-forward-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (message: string) => { git('commit', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD') }
  const ancestor = (a: string, b: string) => {
    try { git('merge-base', '--is-ancestor', a, b); return true } catch { return false }
  }
  let base: string, hours: string, latest: string, release: string
  beforeAll(() => {
    git('init', '-b', 'development')
    git('config', 'user.name', 'Synthetic deployment test')
    git('config', 'user.email', 'deploy-test@example.invalid')
    base = commit('base')
    hours = commit('hours feature')
    latest = commit('next integrated feature')
    git('switch', '-c', 'fixed-release', base)
    release = commit('isolated release')
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))
  const input = () => ({
    candidate: latest, development: latest, target: 'all',
    live: { worker: hours, admin: hours },
    sources: { worker: latest, admin: latest },
    replay: { worker: false, admin: false },
  })
  it('公開版の全履歴を含む最新版と同一版の再配備を許可する', () => {
    expect(() => assertStagingForward(input(), ancestor)).not.toThrow()
    expect(() => assertStagingForward({ ...input(), live: { worker: latest, admin: latest } }, ancestor)).not.toThrow()
  })
  it('営業時間の後に、そこから分岐した固定リリースを出せない', () => {
    expect(() => assertStagingForward({ ...input(), candidate: release, development: release, sources: { worker: release, admin: release } }, ancestor)).toThrow(/古い版・分岐版/)
    expect(() => assertStagingForward({ ...input(), candidate: base, development: base, sources: { worker: base, admin: base } }, ancestor)).toThrow(/古い版・分岐版/)
  })
  it('待機中に開発が進んだ候補を拒否する', () => {
    expect(() => assertStagingForward({ ...input(), candidate: hours }, ancestor)).toThrow(/待機中/)
  })
  it('Workerだけの配備でも、管理画面で既に公開した履歴を失わせない', () => {
    expect(() => assertStagingForward({ ...input(), target: 'worker', live: { worker: base, admin: release } }, ancestor)).toThrow(/admin/)
    expect(() => assertStagingForward({ ...input(), target: 'admin', live: { worker: release, admin: base } }, ancestor)).toThrow(/worker/)
  })
  it('一部だけ配備済みでも、両公開版を含む後続版で再開できる', () => {
    expect(() => assertStagingForward({ ...input(), live: { worker: latest, admin: hours } }, ancestor)).not.toThrow()
  })
  it.each(['worker', 'admin'] as const)('%sの設定再配備は現在公開中のソースに固定する', component => {
    const correct = input()
    correct.replay[component] = true
    correct.sources[component] = hours
    expect(() => assertStagingForward(correct, ancestor)).not.toThrow()
    expect(() => assertStagingForward({ ...correct, sources: { ...correct.sources, [component]: base } }, ancestor)).toThrow(/現在の公開版/)
    expect(() => assertStagingForward({ ...input(), sources: { ...input().sources, [component]: base } }, ancestor)).toThrow(/差し替える/)
  })
  it.each(['', 'unknown', 'abc123', undefined])('公開版が不明（%s）のときは停止する', invalid => {
    expect(() => assertStagingForward({ ...input(), live: { worker: invalid, admin: hours } }, ancestor)).toThrow(/公開SHA/)
  })
  it('HTTP失敗・不正な版表示を許可へ倒さず、認証値や本文を記録しない', async () => {
    const requests: string[] = []
    const live = await readStagingRevisions(async (url: URL, options: RequestInit) => {
      requests.push(url.pathname)
      expect(options.headers).toBeUndefined()
      expect(options.cache).toBe('no-store')
      expect(options.redirect).toBe('error')
      return Response.json({ git_commit: hours })
    })
    expect(live).toEqual({ worker: hours, admin: hours })
    expect(requests).toEqual(['/admin/version', '/version.json'])
    await expect(readStagingRevisions(async () => new Response('private body', { status: 503 }))).rejects.toThrow('HTTP 503')
    await expect(readStagingRevisions(async () => Response.json({ git_commit: 'unknown' }))).rejects.toThrow(/公開SHA/)
  })
})
