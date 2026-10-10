/*
 * 監査 WEB194/195：更新履歴の数え方と結果の札。
 */
import { describe, expect, it } from 'vitest'
import { historyRows, latestDeploymentPhases, releaseResult } from './history'

const d = (deploymentId: string, phase: 'queued' | 'deploying' | 'verifying' | 'succeeded' | 'failed', occurredAt: string) => ({
  deploymentId, phase, environment: 'production', version: '1.2.0', pullRequest: null, actor: 'github-actions', occurredAt,
})

describe('更新履歴（WEB194/195）', () => {
  it('版の文書に無い実際の配備も表示し、古い段階を重ねず、別の版の説明を借りない', () => {
    const rows = historyRows([
      { version: '1.1.0', released: '2026-10-01T00:00:00Z', entries: [{ text: '前の版の説明' }] },
    ], [d('new', 'succeeded', '2026-10-08T03:05:00Z'), d('new', 'deploying', '2026-10-08T03:01:00Z')])
    expect(rows).toHaveLength(2)
    expect(rows[0].release.version).toBe('1.2.0')
    expect(rows[0].release.entries).toEqual([])
    expect(rows[0].deployment?.phase).toBe('succeeded')
    expect(rows[1].release.entries[0].text).toBe('前の版の説明')
    expect(rows[1].deployment).toBeNull()
  })
  it('195：1回の配備の段階を、別々の更新と数えない（新しい段階だけ残す）', () => {
    const list = latestDeploymentPhases([
      d('dep-1', 'succeeded', '2026-10-08T03:05:00Z'),
      d('dep-1', 'verifying', '2026-10-08T03:03:00Z'),
      d('dep-1', 'deploying', '2026-10-08T03:01:00Z'),
      d('dep-2', 'failed', '2026-10-07T03:00:00Z'),
    ])
    expect(list.map((item) => `${item.deploymentId}:${item.phase}`)).toEqual(['dep-1:succeeded', 'dep-2:failed'])
  })

  it('194：配備の記録が無い・読めないときは「反映済み（成功）」にしない', () => {
    expect(releaseResult(null, 'error')).toEqual({ label: '確認できません', tone: 'muted' })
    expect(releaseResult(null, 'ready').tone).toBe('muted')
    expect(releaseResult(null, 'ready').label).not.toContain('反映済み')
  })
})
