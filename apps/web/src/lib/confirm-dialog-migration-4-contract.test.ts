import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **V6：ブラウザの `confirm()` を設計の確認窓へ移した分の契約（4本目）。**
 *
 * ここで見るのは「そのファイルのどこかに字がある」ではない。
 * **直した関数の本体**と、**その確認窓のJSXだけ**を切り出して見る。
 * ファイル全体を `toContain` で見ると、別の処理に同じ字があるだけで通って
 * しまう（実際に素通りした例がある）。
 */

const SRC = path.join(__dirname, '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/**
 * 文字列・テンプレート literal の中を数えないで `{}` の深さを追う。
 *
 * `` `…${x}…` `` の中の `}` を閉じ括弧と数えると、切り出しがずれる。
 */
type Frame = { mode: 'code' | 'single' | 'double' | 'template'; depth: number }

function scan(src: string, from: number, stop: (depth: number, i: number) => boolean): number {
  const stack: Frame[] = [{ mode: 'code', depth: 0 }]
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const top = stack[stack.length - 1]
    const ch = src[i]
    if (top.mode === 'single' || top.mode === 'double') {
      if (ch === '\\') { i++; continue }
      if ((top.mode === 'single' && ch === "'") || (top.mode === 'double' && ch === '"')) stack.pop()
      continue
    }
    if (top.mode === 'template') {
      if (ch === '\\') { i++; continue }
      if (ch === '`') { stack.pop(); continue }
      // `${` の中はコードに戻る。閉じ括弧は入った深さまで戻ったときだけ数える。
      if (ch === '$' && src[i + 1] === '{') { stack.push({ mode: 'code', depth }); depth++; i++ }
      continue
    }
    if (ch === "'") { stack.push({ mode: 'single', depth }); continue }
    if (ch === '"') { stack.push({ mode: 'double', depth }); continue }
    if (ch === '`') { stack.push({ mode: 'template', depth }); continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') {
      depth--
      // `${` で開いたコードの終わりなら、テンプレート literal へ戻る。
      if (stack.length > 1 && top.depth === depth) stack.pop()
      continue
    }
    if (stop(depth, i)) return i
  }
  throw new Error('切り出しの終わりが見つかりませんでした')
}

/** `marker` で始まる関数の**本体だけ**を返す。 */
function body(src: string, marker: string): string {
  const at = src.indexOf(marker)
  expect(at, `目印が見つかりません: ${marker}`).toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', at)
  const end = scan(src, open + 1, (depth) => depth < 0)
  return src.slice(open, end + 1)
}

/** ファイル中の `<ConfirmDialog …/>` を1つずつ返す。 */
function dialogs(src: string): string[] {
  const out: string[] = []
  let at = src.indexOf('<ConfirmDialog')
  while (at >= 0) {
    const end = scan(src, at + '<ConfirmDialog'.length, (depth, i) =>
      depth === 0 && src.startsWith('/>', i),
    )
    out.push(src.slice(at, end + 2))
    at = src.indexOf('<ConfirmDialog', end)
  }
  return out
}

/** 目印を含む確認窓を1つだけ選ぶ。2つ当たるなら目印が弱い。 */
function dialog(src: string, marker: string): string {
  const hit = dialogs(src).filter((d) => d.includes(marker))
  expect(hit.length, `確認窓が1つに絞れません: ${marker}`).toBe(1)
  return hit[0]
}

/** 直したファイルすべてに共通で当てる。 */
const MIGRATED = [
  'app/automations/page.tsx',
  'app/broadcasts/page.tsx',
  'app/contents/vars/edit/page.tsx',
  'app/conversions/page.tsx',
  'app/events/bookings/page.tsx',
  'app/form-submissions/edit/page.tsx',
  'app/pools/page.tsx',
  'app/reminders/edit/page.tsx',
  'app/rich-menus/edit/page.tsx',
  'app/staff/page.tsx',
  'app/templates/detail/page.tsx',
  'app/templates/page.tsx',
  'app/webhooks/page.tsx',
  'components/broadcasts/broadcast-asset-manager.tsx',
  'components/events/event-form.tsx',
  'components/events/event-wizard.tsx',
  'components/rich-menus/apply-to-tag-modal.tsx',
  'components/scenarios/scenario-list.tsx',
]

describe('V6 確認窓への移行（4本目）', () => {
  it.each(MIGRATED)('%s は共通の確認窓を読み込み、ブラウザのconfirmを残していない', (rel) => {
    const src = read(rel)
    expect(src).toContain("from '@/components/shared/confirm-dialog'")
    expect(dialogs(src).length, '確認窓が置かれていない').toBeGreaterThan(0)
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments, 'ブラウザのconfirmが残っている').not.toMatch(
      /(?:(?:window|globalThis|self)\s*\.\s*confirm\s*\()|(?:(?:^|[^.\w])confirm\s*\()/,
    )
  })

  /*
    `app/rich-menus/edit/page.tsx` はここから外す。**移した3か所には
    `alert()` を残していない**が、同じファイルの「メニュー名を打って消す」
    二重確認（`prompt()` + `alert()`）と画像アップロードの警告がまだ残る。
    それは `confirm()` の置き換えとは別の作業なので、この本では触らない。
    移した3か所の結果を `alert()` にしていないことは、下の
    「リッチメニューの…」で `{notice && (` として見る。
  */
  const NO_ALERT = MIGRATED.filter((rel) => rel !== 'app/rich-menus/edit/page.tsx')

  it.each(NO_ALERT)('%s は alert で失敗を伝えていない', (rel) => {
    const withoutComments = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments, 'alert が残っている').not.toMatch(/(?:^|[^.\w])alert\s*\(/)
  })
})

describe('一斉配信の削除', () => {
  const src = read('app/broadcasts/page.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, '下書きと予約を削除します')

  it('押している間は受け付けず、終わったら必ず戻す', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('} finally {')
    expect(fn).toContain('setDeleting(false)')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('if (deleting) return')
  })

  it('APIの失敗を成功扱いにせず、窓の中に運用者の言葉で出す', () => {
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('配信を削除できませんでした。')
    expect(win).toContain('error={deleteError}')
  })

  it('止まるもの・残るものを本文で読ませ、取り消せない印を付ける', () => {
    expect(win).toContain('予約していた送信は行われません')
    expect(win).toContain('開封・クリックの集計も一緒に消えます')
    expect(win).toContain('すでに送ったメッセージの履歴は残ります')
    expect(win).toContain('この操作は元に戻せません')
    expect(win).toContain('destructive')
  })
})

describe('成果地点の削除', () => {
  const src = read('app/conversions/page.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, '成果地点「')

  it('二度押しを止め、失敗を握りつぶさない', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('成果地点を削除できませんでした。')
    expect(fn).toContain('} finally {')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('承認済みの記録まで消えることを書く', () => {
    expect(win).toContain('ここで記録した成果をすべて削除します')
    expect(win).toContain('承認済みの記録も消えます')
    expect(win).toContain('destructive')
  })

  it('レポートが引けていないときに 0件 と書かない', () => {
    expect(win).toContain('reportAvailable')
    expect(win).toContain('いま何件記録されているかは読み込めていません')
  })
})

describe('テンプレートの削除（一覧）', () => {
  const src = read('app/templates/page.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, 'テンプレート「')

  it('二度押しを止め、失敗を握りつぶさない', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('テンプレートを削除できませんでした。')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('数えられている参照だけを数として出し、数えていないものは断る', () => {
    expect(win).toContain('deleteTarget?.usageCount ?? 0')
    expect(win).toContain('リマインダとリッチメニューからの参照は数えられていません')
    expect(win).toContain('destructive')
  })
})

describe('テンプレートの削除（詳細）', () => {
  const src = read('app/templates/detail/page.tsx')
  const fn = body(src, 'const remove = async ()')
  const win = dialog(src, 'テンプレート「')

  it('二度押しを止め、失敗を握りつぶさない', () => {
    expect(fn).toContain('if (deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('テンプレートを削除できませんでした。')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('使用先が引けていないときに 0か所 と書かない', () => {
    expect(win).toContain('usageLoaded')
    expect(win).toContain('使用先を読み込めていないので')
    expect(win).toContain('数えられていません')
    expect(win).toContain('destructive')
  })
})

describe('オートメーション', () => {
  const src = read('app/automations/page.tsx')

  it('全アカウント共通の切り替えだけ確認を出し、戻せるので destructive を付けない', () => {
    const fn = body(src, 'const handleToggleActive = async (target: Automation)')
    expect(fn).toContain('if (target.lineAccountId === null)')
    expect(fn).toContain('setToggleTarget(target)')
    const win = dialog(src, '全アカウントで停止しますか')
    expect(win).toContain('すべてのアカウントで動かなくなります')
    expect(win).toContain('あとから同じ場所で動かし直せます')
    expect(win).not.toContain('destructive')
    expect(win).toContain('busy={toggling}')
    expect(win).toContain('error={toggleError}')
  })

  it('切り替えは二度押しを止め、失敗を窓に出す', () => {
    const fn = body(src, 'const confirmToggle = async ()')
    expect(fn).toContain('if (!toggleTarget || toggling) return')
    expect(fn).toContain("throw new Error('toggle_failed')")
    expect(fn).toContain('切り替えできませんでした。')
    expect(fn).toContain('setToggling(false)')
  })

  it('削除は取り消せないので destructive を付け、残るものを書く', () => {
    const fn = body(src, 'const confirmDelete = async ()')
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('ルールを削除できませんでした。')
    const win = dialog(src, 'ルール「')
    expect(win).toContain('実行記録も一緒に消えます')
    expect(win).toContain('これまでに付けたタグ・送ったメッセージ・進んだシナリオはそのまま残ります')
    expect(win).toContain('この操作は元に戻せません')
    expect(win).toContain('destructive')
  })
})

describe('プール', () => {
  const src = read('app/pools/page.tsx')

  it('プールの削除は外部キーの向きどおりに書く', () => {
    const fn = body(src, 'const onDelete = async ()')
    expect(fn).toContain('if (isMain || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('プールを削除できませんでした。')
    const win = dialog(src, 'プール「')
    expect(win).toContain('LINE公式アカウントそのものと友だちは削除しません')
    expect(win).toContain('振り分け先が外れて未設定になります')
    expect(win).toContain('destructive')
  })

  it('アカウントを外すのは戻せるので destructive を付けない', () => {
    const fn = body(src, 'const onRemove = async ()')
    expect(fn).toContain('if (!removeTarget || removing) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('アカウントを外せませんでした。')
    const win = dialog(src, 'このプールから外しますか')
    expect(win).toContain('あとから同じアカウントを選び直せば戻せます')
    expect(win).not.toContain('destructive')
    expect(win).toContain('busy={removing}')
  })
})

describe('外部連携のWebhook削除', () => {
  const src = read('app/webhooks/page.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, 'Webhook「')

  it('受信と送信を1つの経路で消し、二度押しを止める', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain("deleteTarget.direction === 'incoming'")
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('Webhookを削除できませんでした。')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('やり取りの記録が残ることを、受信と送信のどちらでも書く', () => {
    expect(win).toContain('この送信先への通知を止めて')
    expect(win).toContain('この受信口を閉じて')
    expect(win.match(/やり取りの記録は「やり取り」タブに残ります/g)?.length).toBe(2)
    expect(win).toContain('destructive')
  })
})

describe('共通情報の削除（編集画面）', () => {
  const src = read('app/contents/vars/edit/page.tsx')
  const fn = body(src, 'const remove = async ()')
  const win = dialog(src, 'を削除しますか？')

  it('二度押しを止め、失敗を窓に出す', () => {
    expect(fn).toContain('if (!item || !selectedAccountId || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('共通情報を削除できませんでした。')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('次回予約も消えること、差し込みが空欄になることを書く', () => {
    expect(win).toContain('まだ反映していない次回予約を削除します')
    expect(win).toContain('テンプレート、配信、フォルダ、友だちは削除しません')
    expect(win).toContain('空欄のまま送られ続けます')
    expect(win).toContain('destructive')
  })
})

describe('イベント予約の運営キャンセル', () => {
  const src = read('app/events/bookings/page.tsx')
  const fn = body(src, 'async function adminCancel()')
  const win = dialog(src, '運営側でキャンセルしますか')

  it('二度押しを止め、失敗を窓に出す', () => {
    expect(fn).toContain('if (!cancelTarget || !selectedAccountId || !eventId || cancelling) return')
    expect(fn).toContain('キャンセルできませんでした。')
    expect(fn).toContain('setCancelling(false)')
    expect(win).toContain('busy={cancelling}')
    expect(win).toContain('error={cancelError}')
  })

  it('通知が取り消せないことを書き、destructive を付ける', () => {
    expect(win).toContain('LINEでキャンセルのお知らせを送ります')
    expect(win).toContain('送ったお知らせは取り消せません')
    expect(win).toContain('destructive')
  })
})

describe('回答フォームのページ削除', () => {
  const src = read('app/form-submissions/edit/page.tsx')
  const win = dialog(src, '中身ごと削除しますか')

  it('中身が入っているページだけ確認を出す', () => {
    const fn = body(src, 'const askRemoveSection = (index: number)')
    expect(fn).toContain('if (layout.sections[index].blocks.length === 0)')
    expect(fn).toContain('setRemoveSectionIndex(index)')
  })

  it('一緒に消えるもの・行き先が外れることを書く', () => {
    expect(win).toContain('個の項目も一緒に消えます')
    expect(win).toContain('行き先が外れ')
    expect(win).toContain('これまでの回答データは消えません')
  })

  it('保存するまで反映されないので destructive を付けない', () => {
    expect(win).toContain('保存せずにこの画面を離れれば元のままです')
    expect(win).not.toContain('destructive')
  })
})

describe('リマインダの通の削除', () => {
  const src = read('app/reminders/edit/page.tsx')
  const fn = body(src, 'async function handleDeleteStep()')
  const win = dialog(src, 'この通を削除しますか')

  it('二度押しを止め、失敗を窓に出す', () => {
    expect(fn).toContain('if (!deleteStepTarget || deletingStep) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('この通を削除できませんでした。')
    expect(win).toContain('busy={deletingStep}')
    expect(win).toContain('error={deleteStepError}')
  })

  it('いつ送る通なのかを出し、残るものを書く', () => {
    expect(win).toContain('describeReminderTiming')
    expect(win).toContain('ほかの通とリマインダ本体、すでに送った履歴は残ります')
    expect(win).toContain('destructive')
  })
})

describe('リッチメニューのLINE登録・取り下げ・ページ削除', () => {
  const src = read('app/rich-menus/edit/page.tsx')

  it('登録は二度押しを止め、失敗を窓に出す。戻せるので destructive は付けない', () => {
    const fn = body(src, 'async function handlePublish()')
    expect(fn).toContain('if (publishing) return')
    expect(fn).toContain('LINEに登録できませんでした。')
    expect(fn).toContain('setPublishing(false)')
    const win = dialog(src, 'LINEに登録しますか')
    expect(win).toContain('友だちのトーク画面にはまだ出ません')
    expect(win).toContain('あとから「LINEから取り下げ」で戻せます')
    expect(win).toContain('busy={publishing}')
    expect(win).toContain('error={publishError}')
    expect(win).not.toContain('destructive')
  })

  it('取り下げは戻せるので destructive を付けず、消える範囲を書く', () => {
    const fn = body(src, 'async function handleUnpublish()')
    expect(fn).toContain('if (unpublishing) return')
    expect(fn).toContain('取り下げできませんでした。')
    const win = dialog(src, 'LINEから取り下げますか')
    expect(win).toContain('トーク画面からも消えます')
    expect(win).toContain('もう一度「LINEに登録」すれば元に戻せます')
    expect(win).toContain('busy={unpublishing}')
    expect(win).not.toContain('destructive')
  })

  it('参照が残っているページは、押せる形にせず理由だけ読ませる', () => {
    const fn = body(src, 'function removePage(pageId: string)')
    expect(fn).toContain("a.actionType === 'richmenuswitch'")
    expect(fn).toContain('setRemovePageTarget({ page, referrers })')
    const win = dialog(src, 'まだ削除できません')
    expect(win).toContain('referrers.length === 0')
    expect(win).toContain(': undefined')
    expect(win).toContain('行き先が見つからず失敗します')
  })

  it('登録・取り下げの結果は alert ではなく画面に残す', () => {
    expect(src).toContain('{notice && (')
    // 移した3か所の中に `alert()` が1つも残っていないことを、本体だけ見て確かめる。
    for (const marker of [
      'async function handlePublish()',
      'async function handleUnpublish()',
      'function removePage(pageId: string)',
    ]) {
      expect(body(src, marker), `${marker} に alert が残っている`).not.toMatch(
        /(?:^|[^.\w])alert\s*\(/,
      )
    }
  })
})

describe('ログインユーザー', () => {
  const src = read('app/staff/page.tsx')

  it('LINE連携の解除は戻せるので destructive を付けない', () => {
    const fn = body(src, 'const unlinkLine = async ()')
    expect(fn).toContain('if (unlinking) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('LINE連携を解除できませんでした。')
    const win = dialog(src, 'LINE連携を解除しますか')
    expect(win).toContain('LINEでログインできなくなり')
    expect(win).toContain('招待メールからもう一度LINE認証をすれば連携し直せます')
    expect(win).toContain('busy={unlinking}')
    expect(win).not.toContain('destructive')
  })

  it('二段階認証の解除は登録し直せるので destructive を付けない', () => {
    const fn = body(src, 'const disableTwoFactor = async ()')
    expect(fn).toContain('if (!disableTwoFactorTarget || disablingTwoFactor) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('二段階認証を解除できませんでした。')
    const win = dialog(src, '二段階認証を解除しますか')
    expect(win).toContain('LINE認証だけになります')
    expect(win).toContain('QRコードは取り直しになります')
    expect(win).toContain('busy={disablingTwoFactor}')
    expect(win).not.toContain('destructive')
  })
})

describe('一斉配信テンプレートの削除', () => {
  const src = read('components/broadcasts/broadcast-asset-manager.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, 'を削除しますか？')

  it('二度押しを止め、失敗を窓に出す', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('if (!res.success) throw new Error(res.error)')
    expect(fn).toContain('テンプレートを削除できませんでした。')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('引用済みの配信が変わらないことを書く', () => {
    expect(win).toContain('送信済み・予約中の配信は変わりません')
    expect(win).toContain('destructive')
  })
})

describe('イベント編集の予約枠', () => {
  const src = read('components/events/event-form.tsx')

  it('枠の削除は二度押しを止め、失敗を窓に出す', () => {
    const fn = body(src, 'async function deleteSlot()')
    expect(fn).toContain('if (!deleteSlotTarget || !eventId || deletingSlot) return')
    expect(fn).toContain('枠を削除できませんでした。')
    expect(fn).toContain('setDeletingSlot(false)')
    const win = dialog(src, 'この予約枠を削除しますか')
    expect(win).toContain('いま予約は入っていません')
    expect(win).toContain('busy={deletingSlot}')
    expect(win).toContain('destructive')
  })

  it('まとめて作る前に件数を下見させ、0件なら作るボタンを出さない', () => {
    const win = dialog(src, '作られる枠が0件です')
    expect(win).toContain('bulkPreview.slots.length > 0 ?')
    expect(win).toContain(': undefined')
    expect(win).toContain('まだ何も作っていません')
    expect(win).toContain('busy={bulkBusy}')
    expect(win).toContain('error={bulkError}')
  })

  it('途中まで作られた可能性を隠さない', () => {
    const fn = body(src, 'async function createBulkSlots()')
    expect(fn).toContain('if (!bulkPreview || !eventId || bulkBusy) return')
    expect(fn).toContain('途中まで作られていることがあります')
    expect(fn).toContain('await refresh()')
  })
})

describe('イベント作成の予約枠', () => {
  const src = read('components/events/event-wizard.tsx')

  it('まとめて追加は下見を出してから作る', () => {
    const fn = body(src, 'async function addBulk()')
    expect(fn).toContain('setBulkPreview(generated)')
    expect(fn).not.toContain('eventsApi.createSlots')
    const win = dialog(src, '件の予約枠を追加しますか')
    expect(win).toContain('いまある枠は消えません')
    expect(win).toContain('busy={bulkBusy}')
    expect(win).toContain('error={bulkError}')
  })

  it('作る側は二度押しを止め、途中まで作られた可能性を書く', () => {
    const fn = body(src, 'async function createBulk()')
    expect(fn).toContain('if (!bulkPreview || bulkBusy) return')
    expect(fn).toContain('途中まで作られていることがあります')
    expect(fn).toContain('await refreshSlots()')
  })

  it('枠の削除は二度押しを止め、失敗を窓に出す', () => {
    const fn = body(src, 'async function removeSlot()')
    expect(fn).toContain('if (!removeTarget || removing) return')
    expect(fn).toContain('枠を削除できませんでした。')
    expect(fn).toContain('setRemoving(false)')
    const win = dialog(src, 'この予約枠を削除しますか')
    expect(win).toContain('いま申込は入っていません')
    expect(win).toContain('busy={removing}')
    expect(win).toContain('destructive')
  })
})

describe('リッチメニューを全員のデフォルトにする', () => {
  const src = read('components/rich-menus/apply-to-tag-modal.tsx')

  it('デフォルト設定だけ確認を出し、ほかはそのまま実行する', () => {
    const fn = body(src, 'function apply()')
    expect(fn).toContain("if (mode.kind === 'set-default')")
    expect(fn).toContain('setConfirmingDefault(true)')
    expect(fn).toContain('void runApply()')
  })

  it('二度押しを止め、失敗を窓に出す', () => {
    const fn = body(src, 'async function confirmSetDefault()')
    expect(fn).toContain('if (defaultBusy) return')
    expect(fn).toContain('全員のデフォルトに設定できませんでした。')
    expect(fn).toContain('setDefaultBusy(false)')
  })

  it('前の既定が記録されないことまで書き、戻せるので destructive を付けない', () => {
    const win = dialog(src, '全員のデフォルトにしますか')
    expect(win).toContain('これから友だちになる人にも出ます')
    expect(win).toContain('そちらの設定は外れます')
    expect(win).toContain('前にどのメニューがデフォルトだったかは記録されない')
    expect(win).toContain('busy={defaultBusy}')
    expect(win).toContain('error={defaultError}')
    expect(win).not.toContain('destructive')
  })
})

describe('シナリオの削除', () => {
  const src = read('components/scenarios/scenario-list.tsx')
  const fn = body(src, 'const confirmDelete = async ()')
  const win = dialog(src, 'シナリオ「')

  it('親の返事を見て、失敗したら窓を閉じない', () => {
    expect(fn).toContain('if (!deleteTarget || deleting) return')
    expect(fn).toContain('if (!(await onDelete(deleteTarget.id)))')
    expect(fn).toContain('シナリオを削除できませんでした。')
    expect(fn).toContain('setDeleting(false)')
    expect(win).toContain('busy={deleting}')
    expect(win).toContain('error={deleteError}')
  })

  it('配信中の人数が数えられないときに 0人 と書かない', () => {
    expect(win).toContain('deleteTarget?.subscriberCount === undefined')
    expect(win).toContain('いま何人が配信中かは数えられていません')
  })

  it('進み具合まで消えることを書き、destructive を付ける', () => {
    expect(win).toContain('進み具合も一緒に消えます')
    expect(win).toContain('残りが届かなくなります')
    expect(win).toContain('この操作は元に戻せません')
    expect(win).toContain('destructive')
  })

  it('親は成否を返す（返さないと失敗しても消えたように見える）', () => {
    const parent = body(
      read('app/scenarios/page.tsx'),
      'const handleDelete = async (id: string): Promise<boolean>',
    )
    expect(parent).toContain('if (!res.success) throw new Error(res.error)')
    expect(parent).toContain('return true')
    expect(parent).toContain('return false')
  })
})
