import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const overviews = readFileSync(new URL('./webhook-overviews.tsx', import.meta.url), 'utf8')

describe('N-381 見本タブは外部連携の中で開く', () => {
  test('別機能の通知画面を埋め込まない', () => {
    expect(source).not.toContain('NotificationsPage')
    expect(source).not.toContain('@/app/notifications')
  })

  test('見本タブは外部連携の見本パネルを開く', () => {
    expect(source).toContain('WebhookSamples')
    expect(source).toContain("{tab === 'notify' && <WebhookSamples />}")
  })

  test('受け取る見本は種類を選んだ状態の作成へつなげる', () => {
    expect(source).toContain('tab=incoming&source=')
    // 見本に無い値は無視し、空のままにする。
    expect(source).toContain("searchParams.get('source')")
    expect(source).toContain('SOURCE_PRESETS.some')
  })

  test('送る見本は送り先の作成へつなげる', () => {
    expect(source).toContain('OUTGOING_SAMPLES')
    expect(source).toContain('href="/webhooks/new"')
  })
})

describe('N-382 開始/停止の二重押しで意図と逆にならない', () => {
  /*
    #707 で、二重押し防止の印(ref)と送信中の見え方(state)を必ず一緒に動かすため、
    印の付け外しを `beginToggle` / `endToggle` の1か所へ寄せた。ref が正本である
    ことは変えていない（stateを正本にすると、次の描画まで古い値が見えるので
    素早い二重押しを2回とも通す）。ここでは受信・送信の両方がその1か所を
    通っていることを見る。
  */
  test('送信中の行の再押下は送らずに戻る（受信・送信の2つ）', () => {
    expect(source.match(/if \(togglingIdsRef\.current\.has\(key\)\) \{/g)).toHaveLength(2)
    /* 案内を出したあと必ず return する（落とすと素通りして二重に送る）。 */
    expect(source.match(/setToggleBusyNotices\(\(current\) => \(\{ \.\.\.current, \[key\][^\n]*\n {6}return\n {4}\}/g)).toHaveLength(2)
    expect(source.match(/^ {4}beginToggle\(key\)$/gm)).toHaveLength(2)
    expect(source).toContain('togglingIdsRef.current.add(key)')
  })

  test('応答の成否にかかわらず送信中の印を外す（受信・送信の2つ）', () => {
    expect(source.match(/^ {6}endToggle\(key\)$/gm)).toHaveLength(2)
    expect(source).toContain('togglingIdsRef.current.delete(key)')
    expect(source).toContain('finally')
  })

  test('成功時だけ一覧を読み直してサーバ状態へ寄せる', () => {
    expect(source).toContain('if (selectedAccountIdRef.current === requestAccountId) await load()')
  })

  test('失敗時は状態を変えず次に何をすべきか出す', () => {
    expect(source).toContain('状態は変わっていません')
    expect(source).toContain('もう一度お試しください')
  })

  test('行ごとに印を持つので他の行の操作は止めない', () => {
    expect(source).toContain('useRef<Set<string>>(new Set())')
    expect(source).toContain('setToggleFailures((current) => ({')
    expect(source).toContain('data-webhook-toggle-error={key}')
  })
})

describe('#707 送信中が見え、二重押し防止の当て先が残る', () => {
  test('2回目の押下を黙って落とさず、待っている旨を返す（受信・送信の2つ）', () => {
    expect(source.match(/setToggleBusyNotices\(\(current\) => \(\{ \.\.\.current, \[key\]/g)).toHaveLength(2)
    expect(source).toContain('data-webhook-toggle-busy={key}')
    expect(source).toContain('返事が来るまでお待ちください')
  })

  test('送信中の行を一覧へ渡す（受信・送信の2つ）', () => {
    expect(source.match(/togglingIds=\{togglingIdsOf\('(incoming|outgoing)'\)\}/g)).toHaveLength(2)
  })

  /*
    **押せなくして解決しない。**送信中に `止める` を `disabled` にすると、
    二重押しがそもそも起こせず、二重押し防止を外しても
    `webhook-runtime.spec.ts` の試験2が緑のままになる（#705 の実測）。
    幅を固定するのは、吹き出しが `right-full` で左へ伸びるため、文言が伸びると
    ボタンの箱が動き、`dblclick` の2発目が外れかねないから。
  */
  test('外向きは送信中でも押せる状態を保ち、箱の幅を固定する', () => {
    expect(overviews).toContain('data-webhook-toggle-pending={toggling ? `outgoing:${item.id}` : undefined}')
    expect(overviews).toContain('aria-busy={toggling || undefined}')
    expect(overviews).not.toContain('disabled={toggling')
    expect(overviews.match(/className="min-w-36"/g)).toHaveLength(2)
  })

  /*
    内向きも同じ「黙って落とす」作りだったので見え方を揃える。ただし内向きの
    `止める` は詳細の窓の中にあり、`webhook-runtime.spec.ts` に当て先が無い。
    **内向きの見張りはこの文字列の契約だけで、実ブラウザの当て先は無い。**
  */
  test('内向きも送信中だと分かる（実ブラウザの当て先は無い）', () => {
    expect(overviews).toContain('data-webhook-toggle-pending={togglingIds.includes(selected.id) ? `incoming:${selected.id}` : undefined}')
    expect(overviews).toContain("? (selected.isActive ? '止めています…' : '動かしています…')")
  })
})
