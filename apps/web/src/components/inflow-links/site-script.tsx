'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import KpiCard from '@/components/dashboard/kpi-card'

/**
 * サイトスクリプトの案内と、直近の閲覧数。
 *
 * 貼るコードをそのまま出す。手順を文章で説明するより、
 * コピーできる1行がある方が確実に伝わる。
 */
export default function SiteScript() {
  const [pages, setPages] = useState<Array<{ path: string; views: number; visitors: number }>>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // NEXT_PUBLIC_API_URL はビルド時に埋まる。Worker のURLがそのまま入る。
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = `<script src="${apiUrl}/api/site/script.js" async></script>`

  const [summary, setSummary] = useState<{
    todayEvents: number
    todayPageViews: number
    linkedEvents: number
    unlinkedEvents: number
    pathCount: number
    eventTypeCount: number
    lastEventAt: string | null
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pagesRes, sumRes] = await Promise.allSettled([
        api.siteTracking.pages(),
        api.siteTracking.summary(),
      ])
      if (pagesRes.status === 'fulfilled' && pagesRes.value.success) setPages(pagesRes.value.data)
      if (sumRes.status === 'fulfilled' && sumRes.value.success) setSummary(sumRes.value.data)
    } catch {
      // 記録がまだ無い場合もある。表の空欄で伝わる。
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境もある。コードは画面に出ている。
    }
  }

  const linkedRate =
    summary && summary.linkedEvents + summary.unlinkedEvents > 0
      ? Math.round(
          (summary.linkedEvents / (summary.linkedEvents + summary.unlinkedEvents)) * 1000,
        ) / 10
      : null

  // 「設置できているか」は設定を見ても分からない。最後にいつ受け取ったかで判断する。
  const receiving = summary?.lastEventAt != null
  const lastSeen = summary?.lastEventAt
    ? `${summary.lastEventAt.slice(0, 10)} ${summary.lastEventAt.slice(11, 16)}`
    : null

  return (
    <div>
      <p className="text-ink-faint mb-4 text-xs leading-relaxed">
        自社サイトにコードを埋め込むと、サイト上の行動をLINEの友だちに結びつけて記録できます。「商品ページを見たが買わなかった人」への配信ができるようになります。
      </p>

      <div
        className={`rounded-card mb-4 flex flex-wrap items-center justify-between gap-2 border p-4 ${
          receiving ? 'bg-success-bg border-success-bg' : 'border-hairline bg-canvas'
        }`}
      >
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${receiving ? 'text-success' : 'text-ink-faint'}`}>
            {receiving ? '計測できています' : 'まだ記録が届いていません'}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {receiving
              ? `最終受信 ${lastSeen} ・ 今日 ${summary?.todayEvents.toLocaleString('ja-JP')} 件`
              : 'コードを貼ってから数分で届きはじめます。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void load()}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs font-medium"
          >
            設置を確認
          </button>
          {/* 1件ずつの記録を見る画面が無い。友だち詳細には出るが、
              サイト全体のログを並べる場所を持っていない。 */}
          <button
            disabled
            title="計測ログの一覧は準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-1.5 text-xs opacity-50"
          >
            計測ログを見る
          </button>
          {/* 貼るコードは下に出ている。サイトごとに発行する仕組みは無い。 */}
          <button
            disabled
            title="サイトごとのコード発行は準備中です。貼るコードは下にあります"
            className="border-hairline text-ink-faint rounded-control border px-3 py-1.5 text-xs opacity-50"
          >
            コードを発行
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="今日の計測"
          value={summary?.todayEvents ?? null}
          unit="件"
          detail={`ページ閲覧 ${summary?.todayPageViews ?? 0}`}
          loading={loading}
        />
        <KpiCard
          title="友だちと結びついた"
          value={summary?.linkedEvents ?? null}
          unit="件"
          detail={linkedRate != null ? `${linkedRate}%` : '—'}
          loading={loading}
        />
        <KpiCard
          title="結びつかなかった"
          value={summary?.unlinkedEvents ?? null}
          unit="件"
          detail="LINE経由でない訪問"
          loading={loading}
        />
        <KpiCard
          title="設置ページ"
          value={summary?.pathCount ?? null}
          unit="種類"
          detail={`計測イベント ${summary?.eventTypeCount ?? 0}`}
          loading={loading}
        />
        {/* 「カートに入れた」「購入した」を、URLの条件で決める仕組みが無い。
            どのイベントがカートなのかを機械が知らないので差を出せない。 */}
        <KpiCard title="カート放棄" value={null} unit="人" detail="過去7日" />
      </div>

      <div className="bg-canvas rounded-card border-hairline mb-5 border p-5">
        <h2 className="text-ink mb-2 text-sm font-semibold">サイトに貼るコード</h2>
        <p className="text-ink-secondary mb-3 text-sm">
          すべてのページの{' '}
          <code className="bg-canvas-sunken rounded px-1">&lt;/head&gt;</code>{' '}
          の直前に貼ってください。どのページが見られたかを記録します。
          LIFFやフォームを経由した人は、友だちと結びついて個人の行動として見られるようになります。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-canvas-sunken text-ink-secondary min-w-0 flex-1 overflow-x-auto rounded px-3 py-2 text-xs">
            {snippet}
          </code>
          <button
            onClick={copy}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm font-medium"
          >
            {copied ? 'コピーしました' : 'コードをコピー'}
          </button>
        </div>

        <details className="mt-4">
          <summary className="text-ink-secondary cursor-pointer text-sm font-medium">
            ボタンのクリックや購入も記録したいとき
          </summary>
          <div className="text-ink-secondary mt-2 space-y-2 text-sm">
            <p>
              押されたことを記録したい要素に{' '}
              <code className="bg-canvas-sunken rounded px-1">
                data-lh-event=&quot;名前&quot;
              </code>{' '}
              を付けます。
            </p>
            <code className="bg-canvas-sunken block overflow-x-auto rounded px-3 py-2 text-xs">
              &lt;button data-lh-event=&quot;資料請求&quot;&gt;資料を請求する&lt;/button&gt;
            </code>
            <p>
              購入完了のように、こちらから知らせたいときは{' '}
              <code className="bg-canvas-sunken rounded px-1">
                lhTrack(&apos;購入&apos;, 5000)
              </code>{' '}
              を呼びます。
            </p>
          </div>
        </details>

        <p className="text-ink-faint mt-4 text-xs leading-relaxed">
          URLのクエリ文字列（<code>?</code> より後ろ）は記録しません。
          メールアドレスなどがURLに入っている場合に、それごと保存してしまわないためです。
        </p>
      </div>

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="border-hairline border-b px-4 py-3">
          <p className="text-ink text-sm font-semibold">よく見られているページ（この30日）</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  ページ
                </th>
                <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                  閲覧
                </th>
                <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                  人数
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                    読み込み中...
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                    まだ記録がありません。コードを貼ってから数分で出はじめます。
                  </td>
                </tr>
              ) : (
                pages.map((p) => (
                  <tr key={p.path} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm">{p.path}</td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {p.views.toLocaleString('ja-JP')}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {p.visitors.toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="bg-canvas rounded-card border-hairline mt-5 border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-ink text-sm font-semibold">計測するできごと</h2>
            <p className="text-ink-faint mt-0.5 text-xs">
              URLの条件に当てはまったときに記録します
            </p>
          </div>
          <button
            disabled
            title="できごとの定義は準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-1.5 text-xs opacity-50"
          >
            できごとを追加
          </button>
        </div>
        {/* できごとの定義（対象URL → 起きたときの動作）を保存する場所が無い。
            いまはスクリプトが送ってきたイベントをそのまま記録している。 */}
        <div className="border-hairline mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="text-ink-faint text-xs leading-relaxed">
            できごとの名前・対象URL・起きたときの動作を決める仕組みは準備中です。
            いまはサイトから送られたできごとを、そのまま記録しています。
          </p>
        </div>
        <p className="text-ink-faint mt-2 text-xs leading-relaxed">
          「カートに入れたが購入していない人」は、この2つのできごとの差から自動で抽出されます。配信の絞り込み条件として使えます。（準備中）
        </p>
      </section>

      <section className="bg-canvas rounded-card border-hairline mt-3 border p-5">
        <h2 className="text-ink text-sm font-semibold">どうやって友だちと結びつくか</h2>
        <dl className="mt-3 space-y-3 text-xs leading-relaxed">
          <div>
            <dt className="text-ink-secondary font-medium">1. LINEから開いた場合</dt>
            <dd className="text-ink-faint">
              配信のリンクを踏んでサイトに来た人は、その時点で友だちが特定できます。
            </dd>
          </div>
          <div>
            <dt className="text-ink-secondary font-medium">2. あとからLINEを追加した場合</dt>
            <dd className="text-ink-faint">
              同じブラウザで友だち追加すると、それまでの行動もさかのぼって結びつきます。
            </dd>
          </div>
          <div>
            <dt className="text-ink-secondary font-medium">3. 結びつかない場合</dt>
            <dd className="text-ink-faint">
              検索などから直接来た人は「不明」として記録され、人数の集計にだけ使われます。
            </dd>
          </div>
        </dl>
      </section>

      <section className="bg-canvas rounded-card border-hairline mt-3 border p-5">
        <h2 className="text-ink text-sm font-semibold">個人情報の扱い</h2>
        <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
          <li>・サイト側でCookieの同意を取ってから設置してください</li>
          <li>・入力フォームの中身は送信していません。URLとイベント名だけを記録します</li>
          <li>・友だちが結びついた行動は、その人の履歴として友だち詳細に表示されます</li>
          <li>・利用目的をプライバシーポリシーに記載してください</li>
        </ul>
      </section>
    </div>
  )
}
