import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Issue #670（監査6・画面別の磨き上げ13件）の横断契約。
 * 既存の画面別テストで守るもの（10 webinars / 20 analytics / 23 ec-commerce）
 * 以外の小粒な修正を、字面で見張る。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
/* 注釈中の言及に当たらないよう、コードだけにする */
const codeOf = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const CONTENTS = read('contents', 'page.tsx')
const AUTOMATIONS = read('automations', 'page.tsx')
const AUTO_REPLIES = read('auto-replies', 'page.tsx')
const AFFILIATES = read('affiliates', 'tabs.tsx')
const BOOKING = read('booking', 'bookings', 'page.tsx')
const CHATS = read('chats', 'page.tsx')
const FRIENDS = read('friends', 'page.tsx')
const NOTIFY = read('line-notifications', 'page.tsx')
const NOTIFY_KPIS = read('line-notifications', 'customer-kpis.ts')
const WEBINARS = read('webinars', 'page.tsx')
const ANALYTICS = read('analytics', 'page.tsx')
const BOOKING_MENUS = read('booking', 'menus', 'page.tsx')
const TAG_EDITOR = readFileSync(
  join(HERE, '..', 'components', 'friend-fields', 'tag-editor-v4.tsx'),
  'utf8',
)

describe('#670 15 登録メディアの札の操作5個は同じ寸法', () => {
  it('compact 1種にそろえ、共通Buttonと混ぜない', () => {
    // ★V7（#701）：同じ寸法の小ボタン4つ（12px・rounded-control）＋削除は他の一覧と同じゴミ箱の印。
    // 「同じ寸法にそろえ、大きい共通Buttonを混ぜない」という #670 の狙いはそのまま見張る。
    const footerStart = CONTENTS.indexOf('mt-auto flex flex-wrap items-center justify-end')
    expect(footerStart).toBeGreaterThan(-1)
    const footer = CONTENTS.slice(footerStart, CONTENTS.indexOf('</div>', footerStart))
    expect(
      footer.match(/className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-2\.5 py-1 text-xs whitespace-nowrap[^"]*"/g),
    ).toHaveLength(4)
    expect(footer).toContain('<IconButton')
    expect(footer).not.toContain('<Button')
  })
})

describe('#670 25/09 オートメーションの状態と行高・ページ送り', () => {
  it('状態は他画面と同じ札(Chip)で出す', () => {
    expect(AUTOMATIONS).toContain('<Chip tone={automation.isActive ?')
    expect(AUTOMATIONS).toContain("{automation.isActive ? '動いています' : '止めています'}")
  })

  it('動いた記録はメニューへ移し、行の操作は編集＋…の1行に収める', () => {
    expect(AUTOMATIONS).toContain("id: 'runs'")
    expect(AUTOMATIONS).toContain("label: '動いた記録を見る'")
    expect(AUTOMATIONS).toContain('onViewRuns')
    /* 閲覧のみの見るだけ導線は残す */
    expect(AUTOMATIONS).toContain('href={runsHref}')
  })

  it('1ページだけならページ送りを出さない', () => {
    expect(AUTOMATIONS).toContain('listPageCount > 1 ? (')
    expect(AUTOMATIONS).toContain('aria-label="ページ送り"')
  })
})

describe('#670 08 自動応答の帯と凡例', () => {
  it('案内の帯2段を1本にまとめ、凡例を内側へ入れる', () => {
    expect(AUTO_REPLIES).toContain('最初に当てはまった1つだけ')
    expect(AUTO_REPLIES).toContain('EFFECTIVE_LEGEND.map')
    // ★V7（#701）：1本にまとめた案内は、毎回読むものではないので開閉する欄にしまう。
    expect(AUTO_REPLIES.match(/<Disclosure size="compact" title="ルールの動き方と札の見方"/g)).toHaveLength(1)
  })

  it('凡例の札は一覧の札と同じ共通トークンで出す', () => {
    expect(AUTO_REPLIES).toContain('bg-success-bg px-1.5 py-0.5 text-[10px] font-medium text-success')
    expect(AUTO_REPLIES).toContain('bg-warning-bg px-1.5 py-0.5 text-[10px] text-warning')
    expect(AUTO_REPLIES).not.toContain('text-green-700')
    expect(AUTO_REPLIES).not.toContain('amber-700')
    expect(AUTO_REPLIES).not.toContain('bg-amber-50')
  })
})

describe('#670 16/22 アフィリエイトの操作セルと緑文字', () => {
  it('計測中・停止中は名前の下の札で出し、操作セルに置かない', () => {
    expect(AFFILIATES).toContain("<Chip tone={row.isActive ? 'ok' : 'neutral'}>")
    const toggleAt = AFFILIATES.indexOf('成果を見る')
    const buttonAt = AFFILIATES.indexOf('<AffiliateButton', toggleAt)
    expect(toggleAt).toBeGreaterThan(-1)
    expect(buttonAt).toBeGreaterThan(toggleAt)
    expect(AFFILIATES.slice(toggleAt, buttonAt)).not.toContain('計測中')
  })

  it('AA未満の緑を使わない', () => {
    expect(AFFILIATES).not.toContain('text-green-600')
    expect(AFFILIATES).not.toContain('text-emerald-600')
    expect(AFFILIATES).toContain('text-success')
  })
})

describe('#670 17 予約一覧の押せない保存した条件を置かない', () => {
  it('準備中の死んだボタンを出さない', () => {
    expect(BOOKING).not.toContain('保存した条件は準備中です')
    expect(codeOf(BOOKING)).not.toContain('保存した条件')
  })
})

describe('#670 02 担当者の二重ラベルと並び順の見出し', () => {
  it('受信箱の担当者はプルダウンの自称だけにする', () => {
    expect(CHATS).not.toContain('<span className="shrink-0">担当者</span>')
    expect(CHATS).toContain('label="担当者"')
  })

  it('友だち一覧の並び順には見える見出しを付ける', () => {
    expect(FRIENDS).toContain('並び順</span>')
    expect(FRIENDS).toContain('友だち追加の新しい順')
  })
})

describe('#670 24 お知らせの集計カードは意味で分ける', () => {
  it('お知らせの数と月の送信枠を別の段に分ける', () => {
    expect(NOTIFY).toContain("kpi.group === 'notice'")
    expect(NOTIFY).toContain("kpi.group === 'quota'")
    expect(NOTIFY_KPIS).toContain("group: 'notice'")
    expect(NOTIFY_KPIS).toContain("group: 'quota'")
  })

  it('送信枠の3枚は3列で並ぶ', () => {
    expect(NOTIFY).toContain('sm:grid-cols-3')
  })
})

describe('#670 28 連動アクションのキーボード経路', () => {
  it('各行に上へ・下へがあり、同じ移動で動く', () => {
    expect(TAG_EDITOR).toContain('const moveAction = ')
    expect(TAG_EDITOR).toContain('を上へ`}')
    expect(TAG_EDITOR).toContain('を下へ`}')
  })

  it('つまみのドラッグも実際に動く', () => {
    expect(TAG_EDITOR).toContain('draggable onDragStart')
    expect(TAG_EDITOR).toContain('onDrop={() => {')
    expect(TAG_EDITOR).toContain('つまんで動かすか、↑↓ボタンで順番を変更できます')
  })
})

describe('#670 22 残りのAA未満の緑を共通トークンへ', () => {
  it('success-bg の相手に green-700 を置かない', () => {
    expect(AUTOMATIONS).not.toContain('text-green-700')
    expect(AUTOMATIONS).toContain("'bg-success-bg text-success'")
  })
})

describe('#670 10 ウェビナー一覧の器は中身の高さに合わせる（A8）', () => {
  it('一覧の器に固定の最小高さを持たせない', () => {
    expect(WEBINARS).not.toContain('min-h-[360px]')
  })
})

describe('#670 20 分析の集計待ちは帯1本だけが理由を言う（A9）', () => {
  it('グラフ枠は理由文（stateReason）を繰り返さない', () => {
    expect(ANALYTICS).toContain('reasonShownInBanner')
  })
})

describe('#670 28 予約メニューに押せないドラッグ持ち手を置かない（A12）', () => {
  it('⠿ の飾りを行頭に出さない', () => {
    expect(BOOKING_MENUS).not.toContain('⠿')
  })

  it('並び順を変える実際の経路（編集内の数値欄）は残す', () => {
    expect(BOOKING_MENUS).toContain('label="並び順"')
  })
})
