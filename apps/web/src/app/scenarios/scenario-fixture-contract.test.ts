import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs'),
  'utf8',
)

/**
 * 点検 #495 中8 の再発防止。
 *
 * FRIEND_SCENARIOS の onCompleteMode に契約外の値（'start_other' /
 * 'restart_prev'）が入っていた。正本（packages/shared の Scenario 型）は
 * 'pause' | 'resume_previous' | 'move'。一覧の「終了後」セルが
 * ON_COMPLETE_LABELS 引きで空白になっていた。
 */
describe('シナリオ一覧の終了後モード（点検 #495 中8）', () => {
  it('fixtureは契約内の値だけを使う', () => {
    expect(FIXTURES).not.toContain("'start_other'")
    expect(FIXTURES).not.toContain("'restart_prev'")
  })
})
