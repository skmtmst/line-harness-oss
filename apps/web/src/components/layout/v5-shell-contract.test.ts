import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WEB = join(ROOT, '..', '..', '..')
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8')

describe('V5共通ヘッダー・パンくず・タブ', () => {
  const breadcrumb = read('src', 'components', 'layout', 'breadcrumb.tsx')

  it('R098Zのパンくずをリンク・現在地・省略へ対応させる', () => {
    expect(breadcrumb).toContain('data-design-node="R098Z"')
    expect(breadcrumb).toContain("{ label: '…' }")
    expect(breadcrumb).toContain("aria-current={current ? 'page' : undefined}")
  })
})
