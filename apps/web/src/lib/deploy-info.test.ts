import { describe, expect, it } from 'vitest'
import {
  deployEnvLabel,
  formatDeployedAt,
  formatDeployInfo,
  isRealVersion,
  shortCommit,
} from './deploy-info'

/**
 * 監査 m18e・設計 E（メニューの下の版の表示）の組み立て。
 * 仮の値（0.0.0-dev・unknown・1970年・ゼロ埋め）は出さない。
 */
describe('版の表示の組み立て（m18e）', () => {
  it('版・commit・日時・環境がそろうと2行になる', () => {
    const lines = formatDeployInfo({
      version: '2.7.0',
      worker_hash: 'sha256:abc',
      admin_hash: 'sha256:def',
      liff_hash: 'sha256:012',
      git_commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      deploy_env: 'staging',
      released_at: '2026-09-27T04:05:00Z',
    })
    expect(lines).toEqual({
      line1: 'Ver. 2.7.0（a1b2c3d）',
      line2: '9/27 13:05 配備・検証環境',
    })
  })

  it('本番は「本番環境」。知らない環境はそのまま出す', () => {
    expect(deployEnvLabel('production')).toBe('本番環境')
    expect(deployEnvLabel('demo-1')).toBe('demo-1')
    expect(deployEnvLabel(null)).toBeNull()
    expect(deployEnvLabel('  ')).toBeNull()
  })

  it('仮の版（0.0.0-dev・空）は版の情報なし（null）', () => {
    expect(isRealVersion('0.0.0-dev')).toBe(false)
    expect(isRealVersion('')).toBe(false)
    expect(isRealVersion(null)).toBe(false)
    expect(isRealVersion('0.24.0')).toBe(true)
    expect(formatDeployInfo({
      version: '0.0.0-dev',
      worker_hash: '',
      admin_hash: '',
      liff_hash: '',
      git_commit: 'unknown',
      deploy_env: 'staging',
      released_at: '1970-01-01T00:00:00Z',
    })).toBeNull()
    expect(formatDeployInfo(null)).toBeNull()
  })

  it('commit が仮・不明・ゼロ埋めのときは版の行だけ出す', () => {
    for (const commit of ['unknown', '', '0000000000000000000000000000000000000000', 'xyz']) {
      expect(shortCommit(commit)).toBeNull()
    }
    expect(shortCommit('A1B2C3D4E5')).toBe('a1b2c3d')
    const lines = formatDeployInfo({
      version: '0.24.0',
      worker_hash: '',
      admin_hash: '',
      liff_hash: '',
      git_commit: 'unknown',
      deploy_env: 'production',
      released_at: '2026-09-27T04:05:00Z',
    })
    expect(lines?.line1).toBe('Ver. 0.24.0')
    expect(lines?.line2).toBe('9/27 13:05 配備・本番環境')
  })

  it('日時が変なときは日時を出さない。日時も環境も無ければ1行だけ', () => {
    expect(formatDeployedAt('1970-01-01T00:00:00Z')).toBeNull()
    expect(formatDeployedAt('not-a-date')).toBeNull()
    expect(formatDeployedAt('')).toBeNull()
    const lines = formatDeployInfo({
      version: '0.24.0',
      worker_hash: '',
      admin_hash: '',
      liff_hash: '',
      git_commit: 'a1b2c3d4e5f6',
      deploy_env: null,
      released_at: '',
    })
    expect(lines).toEqual({ line1: 'Ver. 0.24.0（a1b2c3d）', line2: '' })
  })
})
