/*
 * 受信箱V6・機能2（`xGLVe` `f0zn6` `H3lAOB` `Xi4x9` `B7CER8`）の画面契約。
 *
 * **ファイル全体を `toContain` で見ない。** 2000行の画面に対して全体照合を
 * すると、別の場所に同じ字が1つでもあれば素通りする。ここでは対象の関数の
 * 本体か、対象のJSXの区間だけを切り出して見る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const SIDEBAR = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')

/**
 * `start` から `end` までを切り出す。**印が無ければ落とす。**
 * 印を消したまま試験が通ると、何も見ていない試験になる。
 */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`区間の始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`区間の終わりが見つかりません: ${end}`)
  return source.slice(from, to)
}

/** 関数1つぶんの本体。次の `\nfunction ` までで区切る。 */
function functionBody(source: string, name: string): string {
  return region(source, `function ${name}(`, '\nfunction ')
}

describe('xGLVe 一覧の行（日付・待ち時間・担当）', () => {
  const listDate = functionBody(PAGE, 'formatInboxListDate')
  const waiting = functionBody(PAGE, 'formatWaitingDuration')
  const lineRow = region(PAGE, 'const waitingLabel = needsAttention', '{/* Right Panel: Chat Detail */}')

  it('日付は年を出さず MM/DD だけにする', () => {
    expect(listDate).toContain("getMonth() + 1")
    expect(listDate).toContain('getDate()')
    expect(listDate).not.toContain('getFullYear()')
  })

  it('取れない日時は空欄や Invalid Date ではなく — を出す', () => {
    expect(listDate).toContain("if (!iso) return '—'")
    expect(listDate).toContain("if (Number.isNaN(d.getTime())) return '—'")
    expect(waiting).toContain('if (!iso) return null')
    expect(waiting).toContain('if (!Number.isFinite(at)) return null')
  })

  it('待ち時間は分・時間で出し、負の値は出さない', () => {
    expect(waiting).toContain('if (minutes < 0) return null')
    expect(waiting).toContain('${minutes}分')
    expect(waiting).toContain('${hours}時間${minutes % 60}分')
  })

  it('行は待ち時間があればそれを、無ければ日付を出す', () => {
    expect(lineRow).toContain('{waitingLabel ? (')
    expect(lineRow).toContain('formatInboxListDate(chat.lastMessageAt)')
    // 年入りの旧書式へ戻さない。
    expect(lineRow).not.toContain('formatDatetime(')
  })

  it('担当者の札は「担当：」を付けて誰の欄か分かる形にする', () => {
    expect(lineRow).toContain('担当：{operatorName ?? \'未割り当て\'}')
  })
})

describe('f0zn6 自分の未読', () => {
  const toggle = region(PAGE, 'data-inbox-v6="mine-unread-toggle"', '</button>')
  const row = region(PAGE, 'const waitingLabel = needsAttention', '<div className="flex items-start gap-3">')

  it('押した状態が読み上げに伝わる形で切り替える', () => {
    expect(toggle).toContain('onClick={() => setMineUnreadOnly((current) => !current)}')
    expect(toggle).toContain('aria-pressed={mineUnreadOnly}')
    expect(toggle).toContain('{mineUnreadCount}')
    expect(toggle).toContain('自分の未読')
  })

  it('札の数は一覧に持っている行から数える（作り物の数を出さない）', () => {
    const count = region(PAGE, 'const mineUnreadCount =', 'const activeFriendId')
    expect(count).toContain('visibleMailItems.filter((item) => item.isUnread).length')
    expect(count).toContain('visibleLineItems.filter((chat) => chat.isUnread).length')
  })

  it('自分あての未読の行は地の色を変える', () => {
    expect(row).toContain('chat.isUnread')
    expect(row).toContain('bg-status-danger-soft')
  })
})

describe('H3lAOB / xGLVe トーク見出しの操作', () => {
  const header = region(PAGE, '<div className="ml-auto flex flex-wrap items-center justify-end gap-2">', '{/* Messages')

  it('設計の並び（★ → 担当 → 対応マーク → 顧客情報）で置く', () => {
    const star = header.indexOf('aria-pressed={chatDetail.isAttention}')
    const operator = header.indexOf('<OperatorDropdown')
    const status = header.indexOf('<StatusDropdown')
    const customer = header.indexOf('data-inbox-v6="customer-info-toggle"')
    expect(star).toBeGreaterThan(-1)
    expect(operator).toBeGreaterThan(star)
    expect(status).toBeGreaterThan(operator)
    expect(customer).toBeGreaterThan(status)
  })

  it('顧客情報は開いていても閉じていても同じ1つのボタンで切り替える', () => {
    expect(header).toContain('onClick={() => setShowFriendInfo((current) => !current)}')
    expect(header).toContain('aria-expanded={showFriendInfo}')
    expect(header).toContain("showFriendInfo ? '顧客情報を閉じる' : '顧客情報を表示'")
    // 「閉じているときだけ出す」形へ戻さない。
    expect(header).not.toContain('{!showFriendInfo && (')
  })
})

describe('B7CER8 内部メモ', () => {
  const popover = region(PAGE, 'data-inbox-v6="internal-memo-popover"', '<div className="rounded-[10px] border border-[#D0D5DD]')
  const toggle = region(PAGE, 'data-inbox-v6="internal-memo-toggle"', '</button>')

  it('画面を覆う窓ではなく、送信欄の上に出る紙にする', () => {
    expect(popover).toContain('absolute bottom-full')
    expect(popover).not.toContain('fixed inset-0')
    expect(popover).not.toContain('aria-modal="true"')
  })

  it('設計の文言をそのまま出す', () => {
    expect(popover).toContain('内部メモを追加')
    expect(popover).toContain('スタッフのみ')
    expect(popover).toContain('対応方針や引き継ぎ内容を入力してください。顧客には表示・送信されません。')
    expect(popover).toContain('例：次回返信時に配送先住所を確認する')
    expect(popover).toContain('この内容は社内メンバーだけが確認できます')
    expect(popover).toContain('メモを保存')
  })

  it('保存の口へつなぎ、書き換えていないうちは押せない', () => {
    expect(popover).toContain('onClick={() => void handleSaveMemo()}')
    expect(popover).toContain("disabled={memoSaving || memoDraft === (chatDetail?.notes ?? '')}")
  })

  it('開いている間は「内部メモ」ボタン自身が印になる', () => {
    expect(toggle).toContain('aria-expanded={showMemoEditor}')
    expect(toggle).toContain('bg-status-warn-soft')
  })
})

describe('Xi4x9 右パネルの表示項目', () => {
  const panel = region(SIDEBAR, 'data-inbox-v6="detail-sections-panel"', '</div>\n        )}')

  it('設計の見出しを出す', () => {
    expect(panel).toContain('右パネルの表示項目')
  })

  it('掴んで動かす形は無いので「ドラッグ」と書かない', () => {
    expect(panel).not.toContain('ドラッグ')
    expect(panel).toContain('上へ／下へ')
  })

  it('出し入れは素のチェックを土台にした入／切で読み上げにも伝わる', () => {
    expect(panel).toContain('type="checkbox"')
    expect(panel).toContain('role="switch"')
    expect(panel).toContain('className="peer sr-only"')
    expect(panel).toContain('peer-checked:bg-accent')
    // 軌道と丸は input の兄弟でないと `peer-checked:` が効かない。
    expect(panel).toContain('peer-checked:translate-x-4')
    expect(panel).not.toContain('<span className="rounded-pill bg-step-idle peer-checked:bg-accent peer-focus-visible:ring-accent/40 flex')
  })

  it('全部隠しても戻せる道と、閉じる道を置く', () => {
    expect(panel).toContain('初期状態に戻す')
    expect(panel).toContain('setSectionOrder(DETAIL_SECTIONS.map((item) => item.key))')
    expect(panel).toContain('setHiddenSections([])')
    expect(panel).toContain('完了')
  })
})
