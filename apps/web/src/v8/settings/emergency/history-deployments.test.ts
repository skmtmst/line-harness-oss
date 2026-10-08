/*
 * 監査 WEB194/195：更新履歴の数え方と結果の札。
 */
import { describe, expect, it } from 'vitest'
import { latestDeploymentPhases, releaseResult } from './history'

const d = (deploymentId: string, phase: 'queued' | 'deploying' | 'verifying' | 'succeeded' | 'failed', occurredAt: string) => ({
  deploymentId, phase, environment: 'production', version: '1.2.0', pullRequest: null, actor: 'github-actions', occurredAt,
})

describe('更新履歴（WEB194/195）', () => {
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
