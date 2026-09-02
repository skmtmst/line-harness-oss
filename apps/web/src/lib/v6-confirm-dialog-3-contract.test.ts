import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * V6: ブラウザの `confirm()` を共通の確認窓へ移した3本目の契約。
 *
 * **ファイル全体を `toContain` で見ない。** 画面のコードは長く、別の処理に
 * 同じ字が1つあるだけで通ってしまう。実際、`app/reminders/page.tsx` の
 * 「もう一度試す」は反映履歴の本文にも出ていて、全体一致では見分けが
 * つかなかった。ここでは**その関数の本体**と**その確認窓のJSX**だけを
 * 切り出してから確かめる。
 */

const SRC = path.join(__dirname, '..')
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8')

/** 注意書きの中の字に当てないため、コメントを外す。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 名前の付いた関数の本体だけを切り出す。
 *
 * 中括弧を数えて、隣の関数を巻き込まない。次の `const` まで、のような
 * 切り方だと、間に関数が増えたときに黙って範囲が広がる。
 */
function fnBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  expect(start, `関数が見つかりません: ${signature}`).toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`関数の閉じ括弧が見つかりません: ${signature}`)
}

/**
 * 目印を含む確認窓のJSXだけを切り出す。
 *
 * 1つの画面に確認窓が複数あるので、`<ConfirmDialog` の1つ目を取ると
 * 別の窓を見てしまう。目印（見出しの文など）で選ぶ。
 */
function confirmDialogWith(src: string, anchor: string): string {
  let from = 0
  for (;;) {
    const start = src.indexOf('<ConfirmDialog', from)
    expect(start, `確認窓が見つかりません: ${anchor}`).toBeGreaterThanOrEqual(0)
    const end = src.indexOf('</ConfirmDialog>', start)
    const block = src.slice(start, end < 0 ? src.length : end)
    if (block.includes(anchor)) return block
    from = start + 1
  }
}

describe('リッチメニュー編集の確認窓', () => {
  const src = read('app', 'rich-menus', 'edit', 'page.tsx')

  it('ページ削除は窓を開くだけで、消せない理由があるときは押し口を出さない', () => {
    const ask = fnBody(code(src), 'function askRemovePage')
    expect(ask, '窓を開いていない').toContain("setConfirmKind('removePage')")
    expect(ask, '押した時点のページを掴んでいない').toContain('setRemovePageTarget(target)')

    const remove = fnBody(code(src), 'function removePage(')
    expect(remove, '消せない理由があるのに消している').toContain(
      'if (removePageBlockers(target).length > 0) return',
    )

    const dialog = confirmDialogWith(src, 'removePageBlockers')
    // 保存前なら開き直せば戻るので、赤い窓にしない。
    expect(dialog, '戻せる操作に destructive を付けている').not.toContain('destructive')
    expect(dialog, '戻せることを書いていない').toContain('戻せます')
    expect(dialog, '消える数を書いていない').toContain('removePageTarget.areas.length')
    // rich_menu_area_taps に外部キーは無い。押された記録は残る。
    expect(dialog, '押された記録が残ることを書いていない').toContain(
      '押された回数の記録は残ります',
    )
  })

  it('ページ削除の理由は窓の中に出す（alert に戻していない）', () => {
    const blockers = fnBody(code(src), 'function removePageBlockers')
    expect(blockers, 'alert へ戻っている').not.toContain('alert(')
    expect(blockers, '最後の1ページを止めていない').toContain('最低1ページ必要です')
    expect(blockers, 'タブ切替の参照を見ていない').toContain('richmenuswitch')
  })

  it('LINE登録は二度押しを止め、失敗を握りつぶさない', () => {
    const body = fnBody(code(src), 'async function handlePublish')
    expect(body, '二度押しを止めていない').toContain(
      'if (publishing || unpublishing || saving || busy) return',
    )
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error')
    expect(body, '処理中の印を戻していない').toMatch(/finally\s*\{\s*setPublishing\(false\)/)
    expect(body, '失敗を窓に出していない').toContain('setConfirmError(')
    expect(body, 'alert へ戻っている').not.toContain('alert(')
    // 生のAPIエラーを窓に流していない。
    expect(body, '生のAPIエラーを出している').not.toContain('setConfirmError(e')

    const dialog = confirmDialogWith(src, 'LINEに登録しますか')
    // 「LINEから取り下げ」で戻せるので destructive は付けない。
    expect(dialog, '戻せる操作に destructive を付けている').not.toContain('destructive')
    expect(dialog, '処理中を窓に渡していない').toContain('busy={publishing}')
    expect(dialog, 'まだ友だちに出ないことを書いていない').toContain('友だちのトーク画面には出ません')
  })

  it('LINE取り下げは二度押しを止め、失敗を握りつぶさない', () => {
    const body = fnBody(code(src), 'async function handleUnpublish')
    expect(body, '二度押しを止めていない').toContain(
      'if (publishing || unpublishing || saving || busy) return',
    )
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error')
    expect(body, '処理中の印を戻していない').toMatch(/finally\s*\{\s*setUnpublishing\(false\)/)
    expect(body, 'alert へ戻っている').not.toContain('alert(')

    const dialog = confirmDialogWith(src, 'LINEから取り下げますか')
    expect(dialog, '戻せる操作に destructive を付けている').not.toContain('destructive')
    expect(dialog, '処理中を窓に渡していない').toContain('busy={unpublishing}')
    expect(dialog, 'もう一度出せることを書いていない').toContain('戻せます')
  })
})

describe('リマインダ編集の通の削除', () => {
  const src = read('app', 'reminders', 'edit', 'page.tsx')

  it('二度押しを止め、失敗は運用者の言葉で窓に出す', () => {
    const body = fnBody(code(src), 'async function handleDeleteStep')
    expect(body, '二度押しを止めていない').toContain('if (!deleteStep || deletingStep) return')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '処理中の印を戻していない').toMatch(/finally\s*\{\s*setDeletingStep\(false\)/)
    expect(body, '失敗を窓に出していない').toContain('setDeleteStepError(')
    // 生のAPIエラーを窓へ流していない（前は e.message を画面に出していた）。
    expect(body, '生のAPIエラーを出している').not.toMatch(/setDeleteStepError\(e/)
  })

  it('取り消せない操作なので destructive を付け、消える記録まで書く', () => {
    const dialog = confirmDialogWith(src, 'この通を削除しますか')
    expect(dialog, 'destructive が無い').toContain('destructive')
    expect(dialog, '処理中を窓に渡していない').toContain('busy={deletingStep}')
    // friend_reminder_deliveries.reminder_step_id は ON DELETE CASCADE。
    expect(dialog, '記録も消えることを書いていない').toContain('記録も一緒に消えます')
    expect(dialog, '残るものを書いていない').toContain('残ること')
  })
})

describe('回答フォーム編集のページ削除', () => {
  const src = read('app', 'form-submissions', 'edit', 'page.tsx')

  it('中身のあるページだけ確認し、確認は窓で行う', () => {
    const ask = fnBody(code(src), 'const askRemoveSection')
    expect(ask, '窓を開いていない').toContain('setRemoveSectionIndex(index)')
    expect(ask, '空のページまで止めている').toContain('blocks.length ?? 0) === 0')
    expect(code(src), 'window.confirm へ戻っている').not.toContain('window.confirm(')
  })

  it('「元に戻す」で戻せるので destructive を付けない', () => {
    const dialog = confirmDialogWith(src, 'ページ「')
    expect(dialog, '戻せる操作に destructive を付けている').not.toContain('destructive')
    expect(dialog, '戻せることを書いていない').toContain('元に戻す')
    expect(dialog, '消える数を書いていない').toContain('removeSectionTarget.blocks.length')
    expect(dialog, 'つなぎ直す分岐を数えていない').toContain('jumpsInto(layout, removeSectionTarget.id)')
    expect(dialog, '回答が残ることを書いていない').toContain('集まった回答は消えません')
  })

  it('つなぎ直す分岐は全ページを見て数える', () => {
    const body = fnBody(code(src), 'function jumpsInto')
    expect(body, '一部のページしか見ていない').toContain('for (const section of layout.sections)')
    expect(body, '選択肢の行き先を見ていない').toContain('c.jumpToSectionId === sectionId')
  })
})

describe('共通情報編集の削除', () => {
  const src = read('app', 'contents', 'vars', 'edit', 'page.tsx')

  it('押した時点で使用先を読み、読めなければ消させない', () => {
    const open = fnBody(code(src), 'const openDelete')
    expect(open, '使用先を読んでいない').toContain('api.commonVars.deleteImpact(')
    expect(open, '押した時点のアカウントを掴んでいない').toContain('accountId: selectedAccountId')
    expect(open, '読めなかったことを窓に伝えていない').toContain("setDeletePhase('error')")
  })

  it('二度押しを止め、409は使用先を読み直す', () => {
    const body = fnBody(code(src), 'const remove = async')
    expect(body, '二度押し・切替後を止めていない').toContain(
      'if (!deleteTarget || deleting || deleteAccountSwitched) return',
    )
    expect(body, '使用先を読めていないのに消せる').toContain(
      "if (deletePhase !== 'ready' || !deleteImpact?.canDelete) return",
    )
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '409を読み直していない').toContain('api.commonVars.deleteImpact(')
    expect(body, '処理中の印を戻していない').toMatch(/finally\s*\{\s*setDeleting\(false\)/)
    expect(body, '生のAPIエラーを出している').not.toMatch(/setDeleteError\(e\b/)
  })

  it('アカウントが切り替わったら窓を消さず、選び直させる', () => {
    const dialog = confirmDialogWith(src, '共通情報「')
    expect(dialog, 'destructive が無い').toContain('destructive')
    expect(dialog, '切替に気づいていない').toContain('deleteAccountSwitched')
    expect(dialog, '選び直させていない').toContain('閉じてから選び直してください')
    // 切り替わったとき・読めていないときは押し口ごと出さない。
    expect(dialog, '押せるのに何も起きない形になっている').toContain(
      "deleteAccountSwitched || deletePhase !== 'ready' || !deleteImpact?.canDelete",
    )
  })

  it('数えられていない参照を「0か所」に混ぜない', () => {
    const dialog = confirmDialogWith(src, '共通情報「')
    expect(dialog, '数えられていない参照を伏せている').toContain('unavailableReferences.map')
    expect(dialog, '読込中の言い方が決まりと違う').toContain('読み込んでいます')
    expect(dialog, '取得失敗の言い方が決まりと違う').toContain('読み込めませんでした')
    // common_var_schedules は ON DELETE CASCADE。予約も消える。
    expect(dialog, '予約が消えることを書いていない').toContain('更新スケジュールも一緒に消えます')
    expect(dialog, 'テンプレートが空欄になることを書いていない').toContain('空欄で送られます')
  })
})

describe('一斉配信の素材テンプレートの削除', () => {
  const src = read('components', 'broadcasts', 'broadcast-asset-manager.tsx')

  it('二度押しを止め、失敗を握りつぶさない', () => {
    const body = fnBody(code(src), 'const confirmDelete')
    expect(body, '二度押し・切替後を止めていない').toContain(
      'if (!deleteTarget || deleting || accountSwitched) return',
    )
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '処理中の印を戻していない').toMatch(/finally\s*\{\s*setDeleting\(false\)/)
    expect(body, '生のAPIエラーを出している').not.toMatch(/setDeleteError\(e\b/)
  })

  it('押した時点の対象とアカウントを窓に固定する', () => {
    expect(code(src), '押した時点の対象を掴んでいない').toContain(
      'setDeleteTarget({ item, accountId: selectedAccountId })',
    )
    const dialog = confirmDialogWith(src, 'を削除しますか')
    expect(dialog, 'destructive が無い').toContain('destructive')
    expect(dialog, '切替に気づいていない').toContain('accountSwitched')
    expect(dialog, '選び直させていない').toContain('閉じてから選び直してください')
    expect(dialog, '押せるのに何も起きない形になっている').toContain(
      'onConfirm={accountSwitched ? undefined :',
    )
    // 作成画面は選んだ時点で中身を写す。作成済みの配信は動かない。
    expect(dialog, '作成済みの配信が変わらないことを書いていない').toContain(
      '引用した時点の内容を写して持っています',
    )
  })
})
