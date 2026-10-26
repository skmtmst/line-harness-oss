import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { UidMigrationDetail } from '@/lib/api'

vi.hoisted(() => {
  // migration.tsx が参照する api.ts はモジュール評価時に必須。
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { parseUidCsv, runStatusView, splitUidCsvLine } from './migration'
import { FRIENDS_MERGED_TABS } from '@/v8/friends/friends-tabs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = [
  './migration.tsx',
  './use-uid-migration.ts',
  './uid-migration.tsx',
].map((name) => readFileSync(join(HERE, name), 'utf8')).join('\n')
const CSS = readFileSync(new URL('../friends/friends-v8.module.css', import.meta.url), 'utf8')

/**
 * UID移行の対応表（設計 ★管理画面 機能3 `vtBCu`）。点検 #496 の項目2・6・9。
 *
 * **21件目以降も判断できる**こと（ページ送り＋未判断のみ）、
 * **引用符・列ずれの行を結び付けない**こと、**一致先なしに
 * 新規作成を選ばせない**ことを守る。
 * 画面の動き（ページ送り・絞り込み・確認窓・切り戻し・段の表示・タブ）は
 * `migration-uid-flow-react.test.tsx` が描いて確かめる。ここは CSV の読み方・言葉の関数と「置かないもの」だけ。
 */
describe("管理画面 機能3 UID移行の対応表", () => {
  it('引用符の中のカンマで列をずらさない', () => {
    expect(splitUidCsvLine('U1,"山田,太郎",x')).toEqual(['U1', '山田,太郎', 'x'])
  })

  it('二重引用符を1つに戻す', () => {
    expect(splitUidCsvLine('U1,"山田 ""T"" 太郎",x')).toEqual(['U1', '山田 "T" 太郎', 'x'])
  })

  it('閉じていない引用符の行は捨てる', () => {
    expect(splitUidCsvLine('U1,"山田,太郎')).toBeNull()
  })

  it('引用符付きの対応表を取り込める', () => {
    expect(parseUidCsv('old_uid,new_uid\n"old,1","new,1"\nold-2,new-2')).toEqual([
      { oldUid: 'old,1', newUid: 'new,1', evidenceType: 'operator_csv' },
      { oldUid: 'old-2', newUid: 'new-2', evidenceType: 'operator_csv' },
    ])
  })

  it('列の数が合わない行は結び付けず読み飛ばす', () => {
    expect(parseUidCsv('old_uid,new_uid\nold-1,new-1,余分\nold-2')).toEqual([])
  })

  it('必須列がなければ空にする', () => {
    expect(parseUidCsv('foo,bar\nold-1,new-1')).toEqual([])
  })

  it('対応表を先頭20件だけで切らない', () => {
    expect(PAGE).not.toContain('.slice(0, 20)')
  })

  it('一致先なしの行を新規作成に倒さない', () => {
    expect(PAGE).not.toContain("item.newUid ? 'link' : 'create'")
  })

  /*
    FRIEND-14: 行の操作は読み取り専用の「詳細を見る」だけ。
    保存は詳細ダイアログ内の「この組合せを承認」「除外する」が担う。
    「移行内容を確認」という、読むつもりの操作で保存する名前は残さない。
  */
  it('行の操作で保存しない', () => {
    expect(PAGE).not.toContain('移行内容を確認</button>')
    expect(PAGE).not.toContain("onDecide(item, 'link')")
  })
})

/**
 * FRIEND-15/16/33/36: 状態表示と実行・復旧の操作構造。
 */
describe('UID移行の状態と実行・復旧の導線', () => {
  const run = (status: UidMigrationDetail['status'], applied = 0, failed = 0) => ({
    status, counts: { total: applied + failed, auto: 0, review: 0, unmatched: 0, conflict: 0, applied, failed },
  }) as UidMigrationDetail

  it('説明文とバッジは run.status で決め、完了履歴へ未変更と言わない', () => {
    expect(runStatusView(run('completed'), 0)).toMatchObject({
      description: '本移行と照合が完了しています。必要な場合はこの履歴から切り戻せます。',
      badgeLabel: '本移行済み',
    })
    expect(runStatusView(run('rolled_back'), 0).description).toBe('切り戻し済みです。反映した内容は移行前の状態へ戻しています。')
    expect(runStatusView(run('failed', 1, 1), 0).badgeLabel).toBe('一部失敗')
    expect(runStatusView(run('failed', 0, 1), 0).description).toBe('本移行は失敗しました。実データは変更されていません。')
    expect(runStatusView(run('review'), 2)).toMatchObject({ description: '実データはまだ変更していません。', badgeLabel: '要確認 2件' })
  })

  it('本移行は曖昧な名前の入口から直接実行しない', () => {
    // 確認窓を開くだけで実行しないことは描画の試験（FRIEND-33）で押して確かめる。
    expect(PAGE).not.toContain('対応表を確定して次へ')
    expect(PAGE).not.toContain('onClick={onExecute}')
  })
})

describe('UID移行のタブと段組み（#984 LAY-13/14）', () => {
  it('手書きの別タブ実装（青い選択色の nav）へは戻さない', () => {
    expect(PAGE).not.toContain('aria-label="友だち画面"')
    expect(PAGE).not.toContain('border-b-2 pb-3 font-semibold')
  })

  it('友だち主タブの正本は4項目を同じ順で定義し、UID移行は /accounts?tab=migration へ行く', () => {
    expect(FRIENDS_MERGED_TABS.map((tab) => tab.key)).toEqual(['list', 'duplicates', 'merged', 'uid-migration'])
    expect(FRIENDS_MERGED_TABS.find((tab) => tab.key === 'uid-migration')?.href).toBe('/accounts?tab=migration')
  })

  /*
   * 右端の「移行履歴」は下の履歴節へ飛ぶだけの補助リンクで、同じ節が
   * 画面内に常に見えるため置かない（重複を出さない・管理画面判断 2026-09-26）。
   * 「CSVで書き出す・取り込む」は別画面への導線なので残す（描画の試験で押して確かめる）。
   */
  it('下の履歴節へ飛ぶだけの「移行履歴」ボタンは置かない', () => {
    expect(PAGE).not.toContain('href="#migration-history"')
  })

  it('移行元・移行先の選び欄に古い幅の上書きを残さない', () => {
    expect(PAGE).not.toContain('[data-selects-wide] select')
  })

  it('移行元と移行先は同幅の2欄', () => {
    expect(CSS).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })
})

/**
 * カード同士の縦の間隔そろえ（★管理画面 16px・2026-09-26）。
 * 親を縦並び＋gap-4 にし、子ごとの mb/mt で間隔を作らない。
 * 空の案内を白地・枠・角丸のカードの中に出すことは描画の試験で確かめる。
 */
describe("UID移行のカード間隔", () => {
  it('画面の親は縦並び＋gap-4 で、カード間の mb/mt を持たない', () => {
    expect(CSS).toMatch(/\.board\s*\{[^}]*gap: 16px/s)
    // カードの断片（section・帯・履歴節）に個別の縦余白を付けない。
    expect(PAGE).not.toMatch(/<(section|div)[^>]*className="[^"]*\bmb-[46]\b/)
  })

  it('灰色の ListState をカードの外に直接置かない', () => {
    expect(PAGE).not.toMatch(/\} : <ListState kind="empty"/)
  })

  it('対応表ありの中身も gap-4 でそろえ、mb-6（24px）を作らない', () => {
    expect(CSS).toMatch(/\.section\s*\{[^}]*gap: 12px/s)
    expect(PAGE).not.toMatch(/className="[^"]*\bmb-6\b/)
  })
})
