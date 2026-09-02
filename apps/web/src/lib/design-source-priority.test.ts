import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInventoryShape, checkShape } from '../../scripts/verify-design-values.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(
  readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'),
) as {
  $designPriority: { base: string; override: string }
  $v6Verification: {
    representativeNodes: string[]
    partResult: string
    partReferences: Record<string, number>
  }
  required: { tokens: number; v6RepresentativeNodes: number; v6PartNodes: string[] }
  tokens: Record<string, { status?: string } | string>
}
const inventory = JSON.parse(
  readFileSync(join(WEB, 'design', 'pencil-component-inventory.json'), 'utf8'),
) as {
  $snapshot: { reusableComponents: number }
  families: Record<string, { props: string[]; requiredStates: string[] }>
  components: Record<string, {
    classification: string
    impactRoutes: string[]
    family: string
    status: string
    version: { base: string; v6: string }
  }>
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

  it('V6で使われている共通部品の調査記録を消すと契約違反になる', () => {
    expect(contract.$v6Verification.partResult).toContain('tPTMp')
    expect(contract.$v6Verification.partReferences.tPTMp).toBe(54)
    expect(contract.$v6Verification.partReferences.mNUQ3).toBe(4)

    const missingReference = structuredClone(contract)
    delete missingReference.$v6Verification.partReferences.tPTMp
    expect(checkShape(missingReference)).toContain('V6部品 tPTMp の参照数が記録されていません')
  })

  it('Pen.devの再利用部品85件を3段階に分け、状態・影響・V5/V6差を保持する', () => {
    const components = Object.values(inventory.components)
    expect(components).toHaveLength(85)
    expect(inventory.$snapshot.reusableComponents).toBe(85)
    expect(new Set(components.map((component) => component.classification))).toEqual(
      new Set(['global', 'feature', 'screen']),
    )
    expect(components.every((component) => component.impactRoutes.length > 0)).toBe(true)
    expect(components.every((component) => component.version.base === 'V5')).toBe(true)
    expect(checkInventoryShape(contract, inventory)).toEqual([])
  })

  it('部品を消す、誤分類する、影響先を消すと契約違反になる', () => {
    const missing = structuredClone(inventory)
    delete missing.components.Ai3fq
    expect(checkInventoryShape(contract, missing)).toContain(
      'Pen.dev部品が 84 件。必須 85 件を下回っています',
    )

    const wrongClassification = structuredClone(inventory)
    wrongClassification.components.Ai3fq.classification = 'page'
    expect(checkInventoryShape(contract, wrongClassification)).toContain(
      'components.Ai3fq: classification が不正です（page）',
    )

    const missingRoutes = structuredClone(inventory)
    missingRoutes.components.Ai3fq.impactRoutes = []
    expect(checkInventoryShape(contract, missingRoutes)).toContain(
      'components.Ai3fq: impactRoutes がありません',
    )
  })

  it('部品ファミリーからpropsや必須状態を消すと契約違反になる', () => {
    const missingProps = structuredClone(inventory)
    missingProps.families.button.props = []
    expect(checkInventoryShape(contract, missingProps)).toContain('families.button: props がありません')

    const missingStates = structuredClone(inventory)
    missingStates.families.dialog.requiredStates = []
    expect(checkInventoryShape(contract, missingStates)).toContain(
      'families.dialog: requiredStates がありません',
    )
  })
})
