/*
 * 受信箱管理画面・機能2（`xGLVe` `f0zn6` `H3lAOB` `Xi4x9` `B7CER8`）の画面契約。
 *
 * **ファイル全体を `toContain` で見ない。** 2000行の画面に対して全体照合を
 * すると、別の場所に同じ字が1つでもあれば素通りする。ここでは対象の関数の
 * 本体か、対象のJSXの区間だけを切り出して見る。
 */
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatRelative } from '@/lib/format'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const HEAD = readFileSync(join(HERE, '../shared/inbox-conversation-head.tsx'), 'utf8')
const SIDEBAR = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')
const INBOX_FILTER = readFileSync(join(HERE, 'inbox-filter-panel.tsx'), 'utf8')

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
  return region(source, `function ${name}(`, '\nexport function ')
}

describe('xGLVe 一覧の行（日付・待ち時間・担当）', () => {
  const waiting = functionBody(PAGE, 'formatWaitingDuration')


  it('取れない日時は空欄や Invalid Date ではなく — を出す', () => {
    expect(formatRelative(null)).toBe('—')
    expect(formatRelative('invalid')).toBe('—')
    expect(waiting).toContain('if (!iso) return null')
    expect(waiting).toContain('if (!Number.isFinite(at)) return null')
  })

  it('待ち時間は分・時間で出し、負の値は出さない', () => {
    expect(waiting).toContain('if (minutes < 0) return null')
    expect(waiting).toContain('${minutes}分')
    expect(waiting).toContain('${hours}時間${minutes % 60}分')
  })
})

describe('H3lAOB / xGLVe トーク見出しの操作', () => {
  const header = region(PAGE, '{/* Chat Header */}', '{/* Messages') + HEAD

  it('顧客情報は開いていても閉じていても同じ1つのボタンで切り替える', () => {
    expect(header).toContain('onToggle: () => setShowFriendInfo((current) => !current)')
    expect(header).toContain('aria-expanded={panel.open}')
    expect(header).toContain("panel.open ? '顧客情報を閉じる' : '顧客情報を表示'")
    // 「閉じているときだけ出す」形へ戻さない。
    expect(header).not.toContain('{!showFriendInfo && (')
  })


})

describe('B7CER8 内部メモ', () => {
  const popover = region(PAGE, 'data-inbox-v6="internal-memo-popover"', '{/* 中段 */}')
  const toggle = region(PAGE, 'data-inbox-v6="internal-memo-toggle"', '</button>')

  it('保存の口へつなぎ、書き換えていないうちは押せない', () => {
    expect(popover).toContain('onClick={() => void handleSaveMemo()}')
    expect(popover).toContain("disabled={memoSaving || memoDraft === (chatDetail?.notes ?? '')}")
  })

  it('開いている間は「内部メモ」ボタン自身が印になる', () => {
    expect(toggle).toContain('aria-expanded={showMemoEditor}')
  })
})

describe('Xi4x9 右パネルの表示項目', () => {
  const panel = region(SIDEBAR, 'data-inbox-v6="detail-sections-panel"', 'document.body')

  it('設計どおり掴んで順番を変えられる', () => {
    expect(panel).toContain('ドラッグで順番変更')
    expect(panel).toContain('draggable')
    expect(panel).toContain('onDragStart')
    expect(panel).toContain('moveGroupBefore')
  })

  it('出し入れは本物のチェックを土台にした入／切で読み上げにも伝わる', () => {
    // m21u: 素の input＋自作スイッチを共通の Checkbox へ置き換えた。
    // 本物の input を使う性質（読み上げで入／切が伝わる）は保つ。
    expect(panel).toContain('aria-label={`${group.label}を表示`}')
  })

  it('全部隠しても戻せる道と、閉じる道を置く', () => {
    expect(panel).toContain('初期状態に戻す')
    expect(panel).toContain('setSectionOrder(DEFAULT_SECTION_ORDER)')
    expect(panel).toContain('setHiddenSections([])')
    expect(panel).toContain('閉じる')
  })
})

/*
 * LAY-01/LAY-02(#982): 顧客情報の出し方は「3列が収まる幅」で決める。
 * クラス名の有無ではなく、「どの幅で列・どの幅でドロワーか」という
 * 結果が破綻しないことを見る。幅の計算自体は inbox-layout.test.ts が
 * 実値で検証し、ここでは画面がその判定と同じ境界を使うことを確認する。
 */
describe('LAY-01/LAY-02 顧客情報の列とドロワー', () => {
  const panel = region(PAGE, '<InboxSummaryPane', '</InboxSummaryPane>')

  it('顧客情報は狭い幅でも開ける——常時非表示にしない', () => {
    // `hidden xl:block` は1280px未満で常に非表示＝開く手段がなかった。
    expect(panel).not.toContain('hidden xl:block')
    // 狭い幅では fixed のドロワー（背景の暗幕付き）として出す。
    expect(panel).toContain('wide={wideInfoPanel}')
    expect(PAGE).toContain('<InboxInfoBackdrop wide={wideInfoPanel}')
    const backdrop = readFileSync(join(HERE, '../shared/inbox-content.tsx'), 'utf8')
    expect(backdrop).toContain('return wide ? null : <div')
    // 広い幅では従来どおり列として並ぶ。
    expect(panel).toContain('wide={wideInfoPanel}')
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
    expect(HEAD).toContain('aria-expanded={panel.open}')
    expect(HEAD).toContain("panel.open ? '顧客情報を閉じる' : '顧客情報を表示'")
  })
})

/*
 * LAY-03(#982): 「右パネルの表示項目」が top:430px 固定で、
 * 高さ700pxの画面では下の操作が画面外だった。
 */
describe('LAY-03 右パネルの表示項目パネル', () => {

  it('固定座標ではなく、押したボタンの位置を基準に置く', () => {
    expect(SIDEBAR).not.toContain('top: 430')
    expect(SIDEBAR).toContain('settingsButtonRef')
    expect(SIDEBAR).toContain('getBoundingClientRect')
    // 下に収まらなければボタンの上へ開く。
    expect(SIDEBAR).toContain('belowRoom')
    expect(SIDEBAR).toContain('aboveRoom')
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

  it('ヘッダーとフッターを固定し、条件部分だけをスクロールさせる', () => {
    const footer = region(INBOX_FILTER, '<footer', '</footer>')
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
