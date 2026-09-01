'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

/**
 * データ移行（設計 V2 10-5）。
 *
 * 設計は「引き継ぎコードを発行 → 受け取る側で入力 → 内容を確認して取り込む」。
 * その仕組みはまだ無い。設定を書き出す口も、読み込む口も、コードを持つ表も
 * 用意されていない（`account_migrations` は名前が似ているが、友だちを別の
 * アカウントへ移すための表で、設計とは逆のことをする）。
 *
 * ここで出せるのは「何が渡せて、何が渡せないか」と「いま何件あるか」。
 * 件数は本物の数を数えている。移行の実行だけができない。
 */

/** 渡せるもの。数は実際に数える。 */
const TRANSFERABLE = [
  ['タグ', '名前・色・フォルダ'],
  ['友だち情報欄', '項目の定義（値は移りません）'],
  ['シナリオ', 'ステップと本文'],
  ['テンプレート', '本文と差し込み変数'],
  ['自動応答', 'キーワードと動作'],
  ['回答フォーム', '項目と登録先の設定'],
  ['リマインダ', 'ステップと送る時刻'],
  ['共通情報', '名前と値'],
  ['対応マーク', '名前と色'],
] as const

/** 渡せないもの。 */
const NOT_TRANSFERABLE = [
  ['友だち', '移せません'],
  ['トーク履歴', '移せません'],
  ['配信実績・クリック数', '移せません'],
  ['リッチメニュー画像', '画像は移せません（設定のみ）'],
] as const

type Counts = Partial<Record<(typeof TRANSFERABLE)[number][0], number>>

export default function AccountMigration() {
  const { selectedAccountId } = useAccount()
  const [counts, setCounts] = useState<Counts>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setCounts({})
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    void (async () => {
      // 1つ落ちても残りは出す。数えられなかったものは「—」になる。
      const [tags, fields, scenarios, templates, autoReplies, forms, reminders, vars, marks] =
        await Promise.allSettled([
          api.tags.list(),
          api.friendFields.list(selectedAccountId),
          api.scenarios.list(),
          api.templates.list(),
          api.autoReplies.list(),
          api.forms.list(selectedAccountId),
          api.reminders.list(),
          api.commonVars.list(selectedAccountId),
          api.supportMarks.list(selectedAccountId),
        ])
      if (cancelled) return
      const len = (r: PromiseSettledResult<unknown>): number | undefined => {
        if (r.status !== 'fulfilled') return undefined
        const v = r.value as { success?: boolean; data?: unknown }
        return v.success && Array.isArray(v.data) ? v.data.length : undefined
      }
      setCounts({
        タグ: len(tags),
        友だち情報欄: len(fields),
        シナリオ: len(scenarios),
        テンプレート: len(templates),
        自動応答: len(autoReplies),
        回答フォーム: len(forms),
        リマインダ: len(reminders),
        共通情報: len(vars),
        対応マーク: len(marks),
      })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  return (
    <div className="space-y-4">
      <p className="text-ink-secondary text-sm leading-relaxed">
        タグ・シナリオ・テンプレートなどの設定を、別のアカウントに引き継ぐための画面です。友だちそのものは移せません。
      </p>

      <div className="bg-warning-bg text-warning rounded-card p-4 text-sm leading-relaxed">
        移せるのは「設定」だけです。友だち・トーク履歴・配信実績は移せません。新しいアカウントで友だちを集め直す必要があります。
      </div>

      {/* ---- 渡すもの ---- */}
      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">このアカウントの設定を渡す</h2>
        <p className="text-ink-faint mt-1 text-xs leading-relaxed">
          引き継ぎコードを発行し、受け取る側でそのコードを入力してもらう形を予定しています。
        </p>

        <p className="text-ink-secondary mt-3 text-xs font-medium">渡すもの</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TRANSFERABLE.map(([label]) => (
            <span
              key={label}
              className="bg-canvas-sunken text-ink-secondary rounded-pill px-2.5 py-1 text-xs"
            >
              {label}{' '}
              <span className="text-ink tabular-nums">
                {loading ? '…' : (counts[label] ?? '—')}
              </span>
            </span>
          ))}
        </div>

        {/* 設定を書き出す口も、コードを持つ表も無い。 */}
        <button
          disabled
          title="引き継ぎコードの仕組みは準備中です"
          className="border-hairline text-ink-faint rounded-control mt-4 border px-3 py-2 text-sm font-medium opacity-50"
        >
          引き継ぎコードを発行
        </button>
        <p className="text-ink-faint mt-1.5 text-xs leading-relaxed">
          設定を書き出す仕組みも、コードを保存する場所も、まだありません。
        </p>
      </section>

      {/* ---- 受け取る ---- */}
      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">別のアカウントから受け取る</h2>
        <p className="text-ink-faint mt-1 text-xs leading-relaxed">
          受け取ったコードを入力すると、内容を確認してから取り込める形を予定しています。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            disabled
            placeholder="コードを入力"
            aria-label="引き継ぎコード"
            className="border-hairline rounded-control border px-3 py-2 text-sm opacity-50"
          />
          <button
            disabled
            title="引き継ぎコードの仕組みは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
          >
            確認画面へ
          </button>
        </div>
      </section>

      {/* ---- 移せるもの・移せないもの ---- */}
      <section className="bg-canvas rounded-card border-hairline border">
        <div className="border-hairline border-b px-4 py-3">
          <h2 className="text-ink text-sm font-bold">移せるもの・移せないもの</h2>
        </div>
        <dl className="divide-hairline divide-y">
          {TRANSFERABLE.map(([label, note]) => (
            <div key={label} className="flex items-baseline gap-3 px-4 py-2">
              <dt className="text-ink w-32 shrink-0 text-sm font-medium">{label}</dt>
              <dd className="text-ink-faint text-xs">{note}</dd>
            </div>
          ))}
          {NOT_TRANSFERABLE.map(([label, note]) => (
            <div key={label} className="flex items-baseline gap-3 px-4 py-2">
              <dt className="text-ink-faint w-32 shrink-0 text-sm font-medium">{label}</dt>
              <dd className="text-danger text-xs">{note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- 注意 ---- */}
      <section className="bg-canvas-sunken rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">気をつけること</h2>
        <ul className="text-ink-faint mt-2 space-y-1 text-xs leading-relaxed">
          <li>・移行先に同じ名前のものがある場合、上書きされずに別のものとして追加されます</li>
          <li>・シナリオが参照しているテンプレートは、一緒に選ばないと空になります</li>
          <li>・引き継ぎコードは1回だけ使えます。使うと無効になります</li>
          <li>・移行しても、元のアカウントの設定はそのまま残ります</li>
        </ul>
      </section>
    </div>
  )
}
