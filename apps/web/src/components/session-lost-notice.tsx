'use client'

/*
 * セッションが届かなくなったときの案内。
 *
 * 管理画面は `*.pages.dev`、APIは `*.workers.dev` にあり、**別サイト**。
 * ログインのCookieはサイトをまたいで送られるものなので、ブラウザが
 * サードパーティCookieを止めると、**全部のAPIが401**になる。
 *
 * これまでは各画面がそれぞれ「エラー」と出すだけだった。全画面が同時に
 * 壊れるのに、どこにも理由が書いていないので、原因に辿りつけない。
 * 1か所にまとめて、何をすれば直るかまで出す。
 *
 * ログインしていない人と区別する必要がある。ログインの跡（役割の記録）が
 * 残っているのに401なら、**ログインはできたがCookieが届いていない**。
 * 跡が無ければ、ただの未ログインなのでログイン画面へ送る。
 */

import { useEffect, useState } from 'react'
import { SESSION_LOST_EVENT } from '@/lib/api'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Button from '@/components/shared/button'

const ROLE_KEY = 'lh_staff_role'

export default function SessionLostNotice() {
  const [shown, setShown] = useState(false)
  /*
   * ここは閉じられない案内（Escapeでは閉じない）だが、フォーカスが背面の
   * 操作へ漏れないように窓の中へ閉じ込める。背面のスクロールも止める。
   */
  const panelRef = useOverlayFocus(shown, () => {}, true)

  useEffect(() => {
    const onLost = () => {
      // ログインの跡が無ければ、未ログインなので何も出さない
      // （AuthGuard がログイン画面へ送る）。
      if (!window.localStorage.getItem(ROLE_KEY)) return
      setShown(true)
    }
    window.addEventListener(SESSION_LOST_EVENT, onLost)
    return () => window.removeEventListener(SESSION_LOST_EVENT, onLost)
  }, [])

  if (!shown) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-scrim p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-lost-title"
    >
      <div ref={panelRef} className="rounded-card mt-12 w-full max-w-xl bg-canvas p-6 shadow-float">
        <h2 id="session-lost-title" className="text-ink text-lg font-bold">
          ログイン情報がサーバーに届いていません
        </h2>
        <p className="text-ink-secondary mt-2 text-sm leading-relaxed">
          画面はこの端末に、データは別のところにあります。その2つは別サイト扱いなので、
          ブラウザが<strong>サイトをまたぐCookieを止めている</strong>と、
          ログインしていてもサーバーには「誰か分からない」状態で届きます。
          そのため、どの画面を開いてもエラーになります。
        </p>

        <div className="bg-canvas-sunken rounded-card mt-4 p-4">
          <p className="text-ink text-sm font-bold">Chrome での直し方</p>
          <ol className="text-ink-secondary mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>
              アドレスバーの右にある<strong>目のマーク</strong>（または「対応が必要」の表示）を押します
            </li>
            <li>
              <strong>「サードパーティ Cookie を許可」</strong>を選びます
            </li>
            <li>画面を再読み込みします</li>
          </ol>
          <p className="text-ink-faint mt-2 text-xs leading-relaxed">
            シークレットウィンドウや、拡張機能（広告ブロックなど）でも同じことが起きます。
          </p>
        </div>

        <p className="text-ink-faint mt-3 text-xs leading-relaxed">
          Cookieの設定に心当たりがない場合は、単にログインの期限が切れただけかもしれません。
          その場合はログインし直せば直ります。
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" className="text-ink-secondary v7:h-10 px-5 whitespace-normal" type="button" onClick={() => window.location.reload()}>
            再読み込み
          </Button>
          <Button variant="primary" className="v7:h-10 px-5 font-bold border-0 whitespace-normal" type="button" onClick={() => {
              window.localStorage.removeItem(ROLE_KEY)
              window.location.href = '/login'
            }}>
            ログインし直す
          </Button>
        </div>
      </div>
    </div>
  )
}
