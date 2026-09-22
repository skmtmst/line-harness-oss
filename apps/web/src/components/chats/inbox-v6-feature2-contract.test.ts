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
const INBOX_DROPDOWN = readFileSync(join(HERE, 'inbox-dropdown.tsx'), 'utf8')
const INBOX_FILTER = readFileSync(join(HERE, 'inbox-filter-panel.tsx'), 'utf8')
const INBOX_LAYOUT = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'inbox-layout.ts'), 'utf8')

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

describe('f0zn6 一覧の未読表示', () => {
  const row = region(PAGE, 'const waitingLabel = needsAttention', '<div className="flex items-start gap-3">')

  it('設計に無い右端の「自分の未読」操作を置かない', () => {
    expect(PAGE).not.toContain('data-inbox-v6="mine-unread-toggle"')
    expect(PAGE).not.toContain('mineUnreadOnly')
  })

  it('自分あての未読の行は地の色を変える', () => {
    expect(row).toContain('chat.isUnread')
    expect(row).toContain('bg-status-danger-soft')
  })
})

describe('H3lAOB / xGLVe トーク見出しの操作', () => {
  const header = region(PAGE, '<div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">', '{/* Messages')

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

  it('顧客情報を開いても操作列を1行・高さ40pxで保つ', () => {
    // U008/U010(#969): 390px では2行目へ落として右に切らないため、
    // 折り返しは sm 未満だけ。sm 以上では従来どおり1行を保つ。
    expect(header).toContain('sm:flex-nowrap')
    expect(header).toContain('className="inline-flex h-10 shrink-0')
    expect(header).toContain('compact={showFriendInfo}')
    expect(INBOX_DROPDOWN).toContain('whitespace-nowrap border px-2.5 text-xs')
  })
})

describe('#455 受信箱の上端と入力欄', () => {
  it('集計帯を外し、対応ルールだけを絞り込み行へ残す', () => {
    expect(PAGE).not.toContain('data-inbox-v4="summary"')
    expect(PAGE).not.toContain('<InboxKpis')
    expect(PAGE).toContain('href="/tags?tab=marks"')
    expect(PAGE).toContain('対応ルール')
  })

  it('チャネルと並び順は折り返さず、左列を先に縮める', () => {
    expect(PAGE).toContain('mt-2 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden')
    // LAY-01(#982): 顧客情報を開いている間は一覧を288pxに留める。
    // 以前は 2xl で 420px へ急拡大し、3列が 1536px で収まらなくなっていた。
    expect(PAGE).toContain("showFriendInfo ? 'lg:w-72'")
    expect(PAGE).not.toContain("showFriendInfo ? 'lg:w-72 2xl:w-[420px]'")
  })

  it('改行案内を入力欄の下へ置く', () => {
    const composer = region(PAGE, 'data-inbox-v4="composer"', '<TemplatePicker')
    expect(composer.indexOf('aria-label="メッセージを入力"')).toBeLessThan(composer.indexOf("'Shift + Enter で改行'"))
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

  it('設計どおり掴んで順番を変えられる', () => {
    expect(panel).toContain('ドラッグで順番変更')
    expect(panel).toContain('draggable')
    expect(panel).toContain('onDragStart')
    expect(panel).toContain('moveGroupBefore')
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
    expect(panel).toContain('setSectionOrder(DEFAULT_SECTION_ORDER)')
    expect(panel).toContain('setHiddenSections([])')
    expect(panel).toContain('完了')
  })
})

/*
 * LAY-01/LAY-02(#982): 顧客情報の出し方は「3列が収まる幅」で決める。
 * クラス名の有無ではなく、「どの幅で列・どの幅でドロワーか」という
 * 結果が破綻しないことを見る。幅の計算自体は inbox-layout.test.ts が
 * 実値で検証し、ここでは画面がその判定と同じ境界を使うことを確認する。
 */
describe('LAY-01/LAY-02 顧客情報の列とドロワー', () => {
  const talkPane = region(PAGE, 'data-inbox-v4="talk-pane"', '{selectedThreadId ?')
  const panel = region(PAGE, 'data-inbox-v4="customer-panel"', '</aside>')

  it('常設する境界は3列が収まる計算と同じ1536px（Tailwind 2xl）にする', () => {
    expect(INBOX_LAYOUT).toContain('INBOX_INFO_PANEL_MIN_VIEWPORT = 1536')
    // メディアクエリとCSSの `2xl:` は同じ境界を指す。片方だけ変わると
    // 「ドロワーのつもりが列になる」ずれが起きる。
    expect(PAGE).toContain('(min-width: ${INBOX_INFO_PANEL_MIN_VIEWPORT}px)')
    expect(panel).toContain('2xl:relative')
  })

  it('トーク列は最低幅で固定せず、残り幅いっぱいに伸縮する', () => {
    // `xl:min-w-xl`（576px固定）が min-w-0 を上書きして 1280〜1536px で
    // 右列を画面外へ押し出していた。固定の最小幅は持たせない。
    expect(talkPane).toContain('min-w-0 flex-1')
    expect(talkPane).not.toMatch(/min-w-(xs|sm|md|lg|xl|2xl|\[)/)
  })

  it('顧客情報は狭い幅でも開ける——常時非表示にしない', () => {
    // `hidden xl:block` は1280px未満で常に非表示＝開く手段がなかった。
    expect(panel).not.toContain('hidden xl:block')
    // 狭い幅では fixed のドロワー（背景の暗幕付き）として出す。
    expect(panel).toContain('fixed inset-y-0 right-0')
    expect(PAGE).toContain('bg-scrim fixed inset-0 z-[60] 2xl:hidden')
    // 広い幅では従来どおり列として並ぶ。
    expect(panel).toContain('2xl:w-[300px]')
  })

  it('ドロワーは Escape・背景・閉じるボタンで閉じられる', () => {
    expect(PAGE).toContain("event.key === 'Escape'")
    expect(PAGE).toContain('onMouseDown={() => setShowFriendInfo(false)}')
    expect(panel).toContain('aria-label="顧客情報を閉じる"')
    // 狭い幅では dialog として振る舞う（常設列では aria-modal を付けない）。
    expect(panel).toContain("role={wideInfoPanel ? undefined : 'dialog'}")
  })

  it('開閉ボタンの文言・aria-expanded・実表示を一致させる', () => {
    // 同じ1つのボタンが開閉し、パネルは showFriendInfo だけに従う。
    // 「開いていないのに閉じると表示する」状態を作らない(#982 LAY-02)。
    expect(PAGE).toContain('{showFriendInfo && (selectedChatId || selectedThreadId)')
    expect(PAGE).toContain('aria-expanded={showFriendInfo}')
    expect(PAGE).toContain("showFriendInfo ? '顧客情報を閉じる' : '顧客情報を表示'")
  })
})

/*
 * LAY-03(#982): 「右パネルの表示項目」が top:430px 固定で、
 * 高さ700pxの画面では下の操作が画面外だった。
 */
describe('LAY-03 右パネルの表示項目パネル', () => {
  const panel = region(SIDEBAR, 'data-inbox-v6="detail-sections-panel"', 'document.body')

  it('固定座標ではなく、押したボタンの位置を基準に置く', () => {
    expect(SIDEBAR).not.toContain('top: 430')
    expect(SIDEBAR).toContain('settingsButtonRef')
    expect(SIDEBAR).toContain('getBoundingClientRect')
    // 下に収まらなければボタンの上へ開く。
    expect(SIDEBAR).toContain('belowRoom')
    expect(SIDEBAR).toContain('aboveRoom')
  })

  it('最大高さを画面内に収め、項目の並びだけをスクロールする', () => {
    expect(SIDEBAR).toContain('window.innerHeight - margin * 2')
    expect(panel).toContain('min-h-0 flex-1')
    expect(panel).toContain('overflow-y-auto')
    // 見出しと「初期状態に戻す」「完了」はスクロール領域の外に固定する。
    expect(panel.indexOf('overflow-y-auto')).toBeGreaterThan(panel.indexOf('右パネルの表示項目'))
    expect(panel.indexOf('初期状態に戻す')).toBeGreaterThan(panel.indexOf('overflow-y-auto'))
    expect(panel.indexOf('完了')).toBeGreaterThan(panel.indexOf('overflow-y-auto'))
  })

  it('開いているあいだは Escape と画面の変化に追従する', () => {
    expect(SIDEBAR).toContain("event.key === 'Escape'")
    expect(SIDEBAR).toContain("window.addEventListener('resize', updateSettingsPanelPos)")
  })
})

/*
 * LAY-04(#982): 絞り込みパネルが `right:120px; width:420px` 固定で、
 * 390pxでは左側が画面外へ消えていた。
 */
describe('LAY-04 絞り込みパネル', () => {
  it('固定の座標・幅・高さを持たない', () => {
    expect(INBOX_FILTER).not.toContain('right: 120')
    expect(INBOX_FILTER).not.toContain('width: 420')
    expect(INBOX_FILTER).not.toContain('top: 238')
    expect(INBOX_FILTER).not.toContain('maxHeight: 640')
  })

  it('狭い幅では画面内側16pxの範囲へ置く', () => {
    const dialog = region(INBOX_FILTER, 'aria-label="絞り込み"', '<header')
    expect(dialog).toContain('inset-4')
    // 広い幅でも画面端に張り付かない（幅の上限は 100vw-32px）。
    expect(dialog).toContain('min(420px,calc(100vw-2rem))')
    // 高さは残りの画面に連動し、下端を画面外へ出さない。
    expect(dialog).toContain('max-h-[calc(100dvh-5rem)]')
  })

  it('ヘッダーとフッターを固定し、条件部分だけをスクロールさせる', () => {
    const header = region(INBOX_FILTER, '<header', '</header>')
    expect(header).toContain('shrink-0')
    const footer = region(INBOX_FILTER, '<footer', '</footer>')
    expect(footer).toContain('shrink-0')
    const body = region(INBOX_FILTER, '</header>', '<footer')
    expect(body).toContain('overflow-y-auto')
    /*
      INBOX-01: 条件は選んだ時点で即時反映される。フッターの主操作は
      「閉じる」だけで、押すまで反映されないと読める
      「この条件で絞り込む」へは戻さない。
    */
    expect(footer).toContain('閉じる')
    expect(footer).toContain('リセット')
    expect(footer).not.toContain('この条件で絞り込む')
    expect(footer).toContain('条件は選ぶとすぐ一覧に反映されます')
  })
})
