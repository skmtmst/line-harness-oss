import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const MIGRATED = [
  'components/events/event-form.tsx',
  'components/events/event-wizard.tsx',
  'components/rich-menus/apply-to-tag-modal.tsx',
]

describe('V6 確認窓への移行（4本目）', () => {
  it.each(MIGRATED)('%s は共通の確認窓を使い、ブラウザの確認・警告を残さない', (rel) => {
    const src = withoutComments(read(rel))
    expect(src).toContain("from '@/components/shared/confirm-dialog'")
    expect(src).toContain('<ConfirmDialog')
    expect(src).not.toMatch(
      /(?:(?:window|globalThis|self)\s*\.\s*confirm\s*\()|(?:(?:^|[^.\w])confirm\s*\()/,
    )
    expect(src).not.toMatch(/(?:^|[^.\w])alert\s*\()/)
  })
})

describe('イベント編集の予約枠', () => {
  const src = read('components/events/event-form.tsx')

  it('枠の削除は二度押しを止め、失敗を窓に出す', () => {
    expect(src).toContain('async function deleteSlot()')
    expect(src).toContain('if (!deleteSlotTarget || !eventId || deletingSlot) return')
    expect(src).toContain('枠を削除できませんでした。')
    expect(src).toContain('setDeletingSlot(false)')
    expect(src).toContain('title="この予約枠を削除しますか？"')
    expect(src).toContain('いま予約は入っていません')
    expect(src).toContain('busy={deletingSlot}')
    expect(src).toContain('destructive')
  })

  it('まとめて作る前に件数を下見し、0件なら実行させない', () => {
    expect(src).toContain('bulkPreview.slots.length > 0 ?')
    expect(src).toContain('作られる枠が0件です')
    expect(src).toContain('まだ何も作っていません')
    expect(src).toContain('busy={bulkBusy}')
    expect(src).toContain('error={bulkError}')
  })

  it('途中まで作られた可能性を隠さず、一覧を読み直す', () => {
    expect(src).toContain('async function createBulkSlots()')
    expect(src).toContain('if (!bulkPreview || !eventId || bulkBusy) return')
    expect(src).toContain('途中まで作られていることがあります')
    expect(src).toContain('await refresh()')
  })
})

describe('イベント作成の予約枠', () => {
  const src = read('components/events/event-wizard.tsx')

  it('まとめて追加は下見を出してから作る', () => {
    expect(src).toContain('async function addBulk()')
    expect(src).toContain('setBulkPreview(generated)')
    expect(src).toContain('件の予約枠を追加しますか？')
    expect(src).toContain('いまある枠は消えません')
    expect(src).toContain('busy={bulkBusy}')
    expect(src).toContain('error={bulkError}')
  })

  it('作る側は二度押しを止め、途中まで作られた可能性を書く', () => {
    expect(src).toContain('async function createBulk()')
    expect(src).toContain('if (!bulkPreview || bulkBusy) return')
    expect(src).toContain('途中まで作られていることがあります')
    expect(src).toContain('await refreshSlots()')
  })

  it('枠の削除は二度押しを止め、失敗を窓に出す', () => {
    expect(src).toContain('async function removeSlot()')
    expect(src).toContain('if (!removeTarget || removing) return')
    expect(src).toContain('枠を削除できませんでした。')
    expect(src).toContain('setRemoving(false)')
    expect(src).toContain('title="この予約枠を削除しますか？"')
    expect(src).toContain('いま申込は入っていません')
    expect(src).toContain('busy={removing}')
  })
})

describe('リッチメニューを全員のデフォルトにする', () => {
  const src = read('components/rich-menus/apply-to-tag-modal.tsx')

  it('デフォルト設定だけ確認を出し、ほかはそのまま実行する', () => {
    expect(src).toContain('function apply()')
    expect(src).toContain("if (mode.kind === 'set-default')")
    expect(src).toContain('setConfirmingDefault(true)')
    expect(src).toContain('void runApply()')
  })

  it('二度押しを止め、失敗を窓に出す', () => {
    expect(src).toContain('async function confirmSetDefault()')
    expect(src).toContain('if (defaultBusy) return')
    expect(src).toContain('全員のデフォルトに設定できませんでした。')
    expect(src).toContain('setDefaultBusy(false)')
    expect(src).toContain('busy={defaultBusy}')
    expect(src).toContain('error={defaultError}')
  })

  it('前の既定が記録されないことまで書き、戻せる操作として出す', () => {
    expect(src).toContain('これから友だちになる人にも出ます')
    expect(src).toContain('そちらの設定は外れます')
    expect(src).toContain('前にどのメニューがデフォルトだったかは記録されない')
    expect(src).not.toContain('destructive\n        busy={defaultBusy}')
  })
})
