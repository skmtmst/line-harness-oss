import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShape } from '../../scripts/verify-design-values.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(
  readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'),
) as {
  $designPriority: { base: string; override: string }
  $v6Verification: { representativeNodes: string[] }
  required: { tokens: number; v6RepresentativeNodes: number }
  tokens: Record<string, { status?: string } | string>
}

describe('Pencilの設計優先順位', () => {
  it('共通基盤はV5、対象にV6があればV6を優先する', () => {
    expect(contract.$designPriority.base).toBe('V5')
    expect(contract.$designPriority.override).toContain('V6')
    expect(contract.$v6Verification.representativeNodes).toHaveLength(
      contract.required.v6RepresentativeNodes,
    )
  })

  it('PR #1の12トークンを実画面の照合対象にする', () => {
    const tokens = Object.entries(contract.tokens).filter(([name]) => !name.startsWith('$'))
    expect(tokens).toHaveLength(contract.required.tokens)
    expect(tokens.every(([, token]) => typeof token === 'object' && token.status === 'active')).toBe(true)
  })

  it('V5/V6の優先順位や代表ノードを消すと契約違反になる', () => {
    const wrongBase = structuredClone(contract)
    wrongBase.$designPriority.base = 'V4'
    expect(checkShape(wrongBase)).toContain(
      '設計の優先順位は「共通基盤V5、対象にV6があればV6優先」でなければなりません',
    )

    const missingV6 = structuredClone(contract)
    missingV6.$v6Verification.representativeNodes = []
    expect(checkShape(missingV6)).toContain('V6代表ノードが 0 件。必須 10 件を下回っています')
  })
})
