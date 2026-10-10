// @vitest-environment happy-dom
/*
 * 10-09 オーナー指摘：保存後の「アカウントに配りますか？」で、配るもの（タグの札）が一覧の枠の下にかぶっていた。
 * 配るものは下の帯（選んだ数の横）に置き、一覧の中・外へ負の余白や絶対位置で重ねない。
 * 幅（1152・1440）に依らず重ならないよう、置き場所と CSS の両方を見張る。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SavedDistributionDialog from './saved-distribution-dialog'

afterEach(cleanup)
const folder = { id: 'f', name: '直営店', color: '#2563eb', displayOrder: 0 }
const accounts = [{ id: 'a', name: '然 -NEN- 本店' }, { id: 'b', name: '然 -NEN- 渋谷店' }]
const props = {
  accounts, folders: { folders: [folder] as never, membership: new Map([['a', { folderId: 'f', folder: folder as never }], ['b', { folderId: null, folder: null }]]), failed: false },
  selected: ['a'], onChange: () => {}, filter: 'all', onFilter: () => {}, search: '', onSearch: () => {},
  received: [], receivedFailed: false, busy: false, onLater: () => {}, onDistribute: () => {},
}

describe('保存後に配る窓の配るもの（タグの札）', () => {
  for (const width of [1152, 1440]) {
    it(`${width}：配るものは下の帯の選んだ数の横にあり、一覧の中には無い`, async () => {
      window.innerWidth = width
      render(<SavedDistributionDialog {...props} notice={<span data-testid="tag-pill">あ</span>} />)
      const pill = await screen.findByTestId('tag-pill')
      const info = pill.closest('[data-distribution-notice]')
      expect(info).toBeTruthy()
      expect(info!.textContent).toContain('選んだ 1 アカウント')
      expect(pill.closest('section[aria-label="配るアカウント"]')).toBeNull()
      // フォルダの横のチェック・未配布の札はそのまま。
      expect(screen.getByRole('checkbox', { name: '直営店をまとめて選ぶ' })).toBeTruthy()
      expect(screen.getAllByText('未配布').length).toBe(2)
    })
  }

  it('窓・選ぶ部分の CSS に負の余白・絶対位置を置かない', () => {
    for (const file of ['saved-distribution-dialog.module.css', '../../components/shared/entity-picker.module.css']) {
      // 欄全体のクリック層と視覚非表示radioは一覧の重なりとは無関係。
      const css = readFileSync(join(__dirname, file), 'utf8').replace(/\.(?:fieldTrigger|cardRadio)\s*\{[^}]*\}/g, '')
      expect(css).not.toMatch(/margin[^;]*:\s*-|position:\s*absolute/)
    }
  })
})
