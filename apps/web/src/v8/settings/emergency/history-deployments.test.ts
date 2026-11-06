/*
 * 監査 WEB194/195：更新履歴の数え方と結果の札。
 */
import { describe, expect, it } from 'vitest'
import { latestDeploymentPhases, releaseResult } from './history'
import { buildUpdateCards } from './history-updates'

const d = (deploymentId: string, phase: 'queued' | 'deploying' | 'verifying' | 'succeeded' | 'failed', occurredAt: string) => ({
  deploymentId, phase, environment: 'production', version: '1.2.0', pullRequest: null, actor: 'github-actions', occurredAt,
})

describe('更新履歴（WEB194/195）', () => {
  it('版の文書に無い実際の配備も表示し、古い段階を重ねず、別の版の説明を借りない', () => {
    const cards = buildUpdateCards({
      summary: { releases: [{ version: '1.1.0', released: '2026-10-01T00:00:00Z', entries: [{ kind: 'fixed', text: '前の版の説明', at: '2026-10-01 09:00' }] }] },
      deployments: [d('new', 'succeeded', '2026-10-08T03:05:00Z'), d('new', 'deploying', '2026-10-08T03:01:00Z')],
    })
    expect(cards).toHaveLength(2)
    expect(cards[0].version).toBe('1.2.0')
    expect(cards[0].entries).toEqual([])
    expect(cards[0].highlights).toEqual([])
    expect(cards[0].deployment?.phase).toBe('succeeded')
    expect(cards[1].highlights).toEqual(['前の版の説明'])
    expect(cards[1].deployment).toBeNull()
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
    expect(releaseResult(null, 'error')).toEqual({ label: '確認できません', tone: 'neutral' })
    expect(releaseResult(null, 'ready')).toBeNull()
    expect(releaseResult(null, 'loading')).toBeNull()
  })
})
