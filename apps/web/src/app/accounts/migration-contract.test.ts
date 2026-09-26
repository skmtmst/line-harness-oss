import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // migration.tsx が参照する api.ts はモジュール評価時に必須。
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { parseUidCsv, splitUidCsvLine } from './migration'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'migration.tsx'), 'utf8')
/* #984 LAY-14: 友だち配下の主タブの正本。 */
const TABS = readFileSync(join(HERE, '..', 'friends', 'friends-tabs.ts'), 'utf8')

/**
 * UID移行の対応表（設計 ★V6 機能3 `vtBCu`）。点検 #496 の項目2・6・9。
 *
 * **21件目以降も判断できる**こと（ページ送り＋未判断のみ）、
 * **引用符・列ずれの行を結び付けない**こと、**一致先なしに
 * 新規作成を選ばせない**ことを守る。
 */
describe('V6 機能3 UID移行の対応表', () => {
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

  it('対応表をページで区切って読む', () => {
    expect(PAGE).toContain('limit')
    expect(PAGE).toContain('offset')
    expect(PAGE).toContain('ITEM_PAGE_SIZE')
    expect(PAGE).not.toContain('.slice(0, 20)')
  })

  it('分類と未判断のみの絞り込みを持つ', () => {
    expect(PAGE).toContain('分類で絞り込む')
    expect(PAGE).toContain('未判断のみ')
    expect(PAGE).toContain('pendingOnly')
  })

  it('一致先なしの行に新規作成を選ばせない', () => {
    expect(PAGE).toContain('一致先なし')
    expect(PAGE).not.toContain("item.newUid ? 'link' : 'create'")
  })

  /*
    FRIEND-14: 行の操作は読み取り専用の「詳細を見る」だけ。
    保存は詳細ダイアログ内の「この組合せを承認」「除外する」が担う。
    「移行内容を確認」という、読むつもりの操作で保存する名前は残さない。
  */
  it('行の操作は読み取り専用で、保存はダイアログ内の明示操作だけ', () => {
    expect(PAGE).toContain('詳細を見る')
    expect(PAGE).toContain('この組合せを承認')
    expect(PAGE).toContain('onShowDetail(item)')
    expect(PAGE).toContain("decide(detailItem, 'link')")
    expect(PAGE).not.toContain('移行内容を確認</button>')
    expect(PAGE).not.toContain("onDecide(item, 'link')")
  })
})

/**
 * #984 LAY-13/14: UID移行のタブとフォームの段組み。
 * 主タブは友だち一覧と同じ定義・同じ部品・同じ選択色。
 * 入力は「移行元 → 移行先」の同幅2欄、全幅の利用目的、CSV、操作の順。
 */
/**
 * FRIEND-15/16/33/36: 状態表示と実行・復旧の操作構造。
 */
describe('UID移行の状態と実行・復旧の導線', () => {
  it('説明文とバッジは run.status で連動し、完了履歴へ未変更と言わない', () => {
    expect(PAGE).toContain('runStatusView')
    expect(PAGE).toContain("'本移行と照合が完了しています。必要な場合はこの履歴から切り戻せます。'")
    expect(PAGE).toContain("'切り戻し済みです。反映した内容は移行前の状態へ戻しています。'")
    expect(PAGE).toContain('一部失敗')
  })

  it('対応表の遅延応答は世代番号で捨てる', () => {
    expect(PAGE).toContain('detailTicket')
    expect(PAGE).toContain('ticket !== detailTicket.current')
  })

  it('本移行は確認画面を挟み、入口クリックだけでは実行しない', () => {
    expect(PAGE).toContain('本移行を実行')
    expect(PAGE).toContain('setConfirmExecute(true)')
    // 「確定して次へ」のような曖昧な名前で直接実行しない。
    expect(PAGE).not.toContain('対応表を確定して次へ')
    expect(PAGE).not.toContain('onClick={onExecute}')
  })

  it('完了・一部失敗の履歴から確認付きの切り戻しへ進める', () => {
    expect(PAGE).toContain('この移行を切り戻す')
    expect(PAGE).toContain('api.friendMigrations.rollback')
    expect(PAGE).toContain('rollbackable')
    expect(PAGE).toContain('rollbackConflicts')
  })
})

describe('UID移行のタブと段組み（#984 LAY-13/14）', () => {
  it('主タブは友だち一覧と同じ定義・同じ部品を使う', () => {
    expect(PAGE).toContain("import { FRIENDS_MERGED_TABS } from '@/app/friends/friends-tabs'")
    expect(PAGE).toContain('<MergedTabs')
    expect(PAGE).toContain('active="uid-migration"')
    // 手書きの別タブ実装（青い選択色の nav）へは戻さない。
    expect(PAGE).not.toContain('aria-label="友だち画面"')
    expect(PAGE).not.toContain('border-b-2 pb-3 font-semibold')
  })

  it('友だち主タブの正本は4項目を同じ順で定義する', () => {
    expect(TABS).toContain("key: 'list'")
    expect(TABS).toContain("key: 'duplicates'")
    expect(TABS).toContain("key: 'merged'")
    expect(TABS).toContain("key: 'uid-migration'")
    expect(TABS).toContain("'/accounts?tab=migration'")
  })

  /*
   * 右端の「移行履歴」は下の履歴節へ飛ぶだけの補助リンクで、同じ節が
   * 画面内に常に見えるため置かない（重複を出さない・V7判断 2026-09-26）。
   * 以前この補助リンクの存在を固定していたが、使いやすさの直しを優先し
   * 存在固定をやめる。「CSVで書き出す・取り込む」は別画面への導線なので残す。
   */
  it('下の履歴節へ飛ぶだけの「移行履歴」ボタンは置かない', () => {
    expect(PAGE).not.toContain('href="#migration-history"')
    expect(PAGE).toContain('href="/friends/migrations"')
  })

  it('プルダウンの全幅は画面側の属性スコープで広げる', () => {
    /*
     * shared/ は Claude 所有領域。U063 と同じく、共有部品を改変せず
     * data-selects-wide の属性スコープで select だけを全幅にする。
     * className="w-full" の上書きはモジュールCSSの .default に負けるため使わない。
     */
    expect(PAGE).toContain('data-selects-wide')
    expect(PAGE).toContain('[data-selects-wide] select { width: 100%; }')
    expect(PAGE).toContain('<SelectField aria-label="移行元アカウント"')
    expect(PAGE).toContain('<SelectField aria-label="移行先アカウント"')
    expect(PAGE).not.toContain('size="full"')
    expect(PAGE.match(/<SelectField[^>]*w-full/g) ?? []).toHaveLength(0)
  })

  it('移行元と移行先は同幅の2欄、利用目的は全幅', () => {
    expect(PAGE).toContain('sm:flex-row')
    expect(PAGE.match(/min-w-0 flex-1/g) ?? []).toHaveLength(2)
    expect(PAGE).toContain('利用目的')
    // 利用目的は共通の入力欄（高さ40px・タッチ44pxを部品側が持つ）。
    expect(PAGE).toContain("import { TextField } from '@/components/shared/text-field'")
    expect(PAGE).toContain('<TextField')
  })
})

/**
 * #985 CHK-06 を #1015 で固定: 5段階表示は実データの進捗に連動させる。
 * 先頭だけ常に✓だった固定表示へは戻さない。
 */
describe('UID移行の5段階表示（#1015 CHK-06）', () => {
  it('現在位置は実データの状態から決める', () => {
    // 完了・切り戻しは全段階済み、実行可能・実行中・失敗は本移行の段階、
    // それ以外は要確認の判断の段階を示す。
    expect(PAGE).toContain("active.status === 'completed' || active.status === 'rolled_back'")
    expect(PAGE).toContain('STEPS.length')
    expect(PAGE).toContain("active.status === 'ready' || active.status === 'executing' || active.status === 'failed' || unresolved === 0")
  })

  it('狭い幅は「現在n/5」と全手順の展開にする', () => {
    // sm 未満は5列に押し込まず、現在位置＋展開できる手順一覧へ。
    expect(PAGE).toContain('sm:hidden')
    expect(PAGE).toContain('`現在 ${currentStep + 1}/${STEPS.length}`')
    expect(PAGE).toContain('全手順を見る')
    expect(PAGE).toContain('hidden sm:grid sm:grid-cols-5')
  })

  it('完了・現在・未着手を分け、失敗を完了にしない', () => {
    expect(PAGE).toContain('すべて完了')
    // 済んだ段階だけ✓、現在は▶、先の段階は番号のまま。
    expect(PAGE).toContain("index < currentStep ? '✓' : index === currentStep ? '▶'")
  })
})

/**
 * カード同士の縦の間隔そろえ（★V7 16px・2026-09-26）。
 * 親を縦並び＋gap-4 にし、子ごとの mb/mt で間隔を作らない。
 * 空の案内も白地・枠・角丸のカードの中に出す（灰色の地だけにしない）。
 */
describe('UID移行のカード間隔（★V7 gap-4）', () => {
  it('画面の親は縦並び＋gap-4 で、カード間の mb/mt を持たない', () => {
    expect(PAGE).toContain('data-design-node="vtBCu" className="flex flex-col gap-4"')
    // カードの断片（section・帯・履歴節）に個別の縦余白を付けない。
    expect(PAGE).not.toMatch(/<(section|div)[^>]*className="[^"]*\bmb-[46]\b/)
  })

  it('空の案内は履歴と同じカード（白地・枠・角丸）の中に出す', () => {
    expect(PAGE).toContain('テスト移行の結果')
    expect(PAGE).toContain('テスト移行はまだありません')
    // 灰色の ListState をカードの外に直接置かない。
    expect(PAGE).not.toMatch(/\} : <ListState kind="empty"/)
  })

  it('対応表ありの中身も gap-4 でそろえ、mb-6（24px）を作らない', () => {
    expect(PAGE).toContain('return (<div className="flex flex-col gap-4">')
    expect(PAGE).not.toMatch(/className="[^"]*\bmb-6\b/)
  })
})
