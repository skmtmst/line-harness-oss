import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const DETAIL = readFileSync(join(__dirname, 'detail', 'page.tsx'), 'utf8')
const TABLE = readFileSync(join(__dirname, '..', '..', 'components', 'friends', 'friend-list-table.tsx'), 'utf8')
const DUPLICATES = readFileSync(join(__dirname, '..', 'duplicates', 'page.tsx'), 'utf8')
const USERS = readFileSync(join(__dirname, '..', 'users', 'page.tsx'), 'utf8')

describe('友だち画面のオーナー指摘契約', () => {
  it('一覧を行数に合わせ、表の下に固定の空白を残さない', () => {
    expect(TABLE).not.toContain('min-h-155')
    expect(TABLE).not.toContain('min-h-77.5')
    expect(TABLE).not.toContain('min-h-0 flex-1')
    expect(TABLE).toContain('px-6 py-10')
  })

  it('未対応と注目のみを小さな押し口にし、選択中はチェックで示す', () => {
    // m13i: 札の形は共通 FilterChip 1つにそろえた。
    // 小さな押し口（高さ32）・選択中の✓は部品側が持つ。ここでは結びだけ見る。
    expect(PAGE).toContain("selected={responseFilter === 'unhandled'}")
    expect(PAGE).toContain('selected={attentionOnly}')
    expect(PAGE).toContain('未対応')
    expect(PAGE).toContain('注目のみ')
  })

  it('統合ユーザーの操作行を一重の枠と同じ高さにそろえる', () => {
    expect(USERS).toContain('className={styles.headAction}')
    expect(USERS).toContain('onClick={() => u.setPendingForceRefresh(true)}')
    expect(USERS).toContain('className={styles.toolbar}')
    expect(USERS).toContain('<SearchField')
    expect(USERS).toContain('<Select')
    expect(USERS).toContain('<EntitySelect')
    expect(USERS).toContain('u.setAccount')
    expect(USERS).toContain('u.setUid')

  })
})
