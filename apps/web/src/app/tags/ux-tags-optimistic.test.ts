import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(DIR, name), 'utf8')

const TAB = read('tags-tab-v8.tsx')
const MARKS = read('marks-v8.tsx')
const SEARCHES = read('searches-v8.tsx')
const FIELDS = read('fields-tab-v8.tsx')

/*
 * UX更新 A/B（タグ・友だち情報の欄のV8画面）。
 * B: 押した瞬間に終わる（楽観的）＋失敗は知らせの「もう一度／元に戻す」で戻す。
 * 共通 Toast 以外の自前通知は作らない。
 */
describe('UXタグ B 楽観的＋元に戻す', () => {
  it('タグの星（重要）の列と切り替えは置かない（tagstar・2026-10-09）。知らせから元に戻す口は残す', () => {
    expect(TAB).not.toContain('isStarred: next } : item')
    expect(TAB).not.toContain('★のみ表示')
    expect(TAB).toContain('元に戻す')
    expect(TAB).toContain('notifyToast')
  })

  it('タグの所属・並び替えの失敗は知らせの「もう一度」で戻せる', () => {
    expect(TAB).toContain('もう一度')
    expect(TAB).toContain('onAction')
  })

  it('マーク・検索条件・情報項目の並び替え失敗は知らせの「もう一度」で戻せる', () => {
    for (const src of [MARKS, SEARCHES, FIELDS]) {
      expect(src).toContain('notifyToast')
      expect(src).toContain('もう一度')
      expect(src).toContain('setRetryOrder(next)')
    }
  })
})

/*
 * A: 待ちは共通の骨組み（DelayedSkeleton＋表の行の骨組み）。
 * 4タブの一覧すべてで使う。
 */
describe('UXタグ A 共通の骨組み', () => {
  it('4タブの一覧が共通の骨組みを使っている', () => {
    for (const src of [TAB, MARKS, SEARCHES, FIELDS]) {
      expect(src).toContain('DelayedSkeleton')
      expect(src).toContain('skeleton=')
      expect(src).toContain('aria-busy="true"')
    }
  })
})
