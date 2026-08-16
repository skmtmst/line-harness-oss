'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

/**
 * 機能のオン／オフ。
 *
 * 切ったものだけを記録している。機能を足したときに、既存の環境で
 * 勝手に消えないようにするため。
 */
const FEATURE_GROUPS: Array<{
  label: string
  items: Array<{ key: string; label: string; note: string }>
}> = [
  {
    label: '友だち',
    items: [
      {
        key: 'friend_fields',
        label: '友だち情報欄',
        note: '友だちごとに持たせる項目。テンプレートに差し込めます',
      },
      { key: 'support_marks', label: '対応マーク', note: '友だちの対応状況を表す印' },
      { key: 'saved_searches', label: '保存した検索', note: '絞り込みの条件を保存して呼び出す' },
    ],
  },
  {
    label: 'コンテンツ',
    items: [
      { key: 'media', label: 'メディアライブラリ', note: '画像や動画を1か所にまとめる' },
      { key: 'common_vars', label: '共通情報', note: '営業時間などを1か所で直す' },
    ],
  },
  {
    label: '分析',
    items: [
      { key: 'analytics', label: 'アクセス解析', note: '配信数・クリック・ファネル' },
      {
        key: 'site_tracking',
        label: 'サイトスクリプト',
        note: '自社サイトの行動を友だちに紐づける',
      },
    ],
  },
  {
    label: '予約・イベント',
    items: [
      { key: 'booking', label: '予約管理', note: 'メニューとスタッフの予約' },
      { key: 'events', label: 'イベント予約', note: '定員つきの回を作る' },
      { key: 'webinars', label: 'ウェビナー', note: '動画の視聴と追客' },
    ],
  },
  {
    label: '成果',
    items: [
      { key: 'affiliates', label: 'アフィリエイト', note: '紹介者と報酬の管理' },
      { key: 'mileage', label: 'マイル', note: '行動に応じたポイント' },
      { key: 'ec_commerce', label: 'EC連携', note: '購入データの取り込み' },
      { key: 'nen_campaigns', label: 'NEN配信', note: 'コラムの配信' },
    ],
  },
]

/**
 * サイドバーの並び。
 *
 * ここに出す名前は sidebar.tsx のセクション名と合わせる。ずれると、
 * 並び替えたのに反映されない（知らない名前は無視されるため）。
 */
const SIDEBAR_SECTIONS = ['メイン', '配信', '分析', 'EC', '予約', '設定']

export default function SettingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [order, setOrder] = useState<string[]>(SIDEBAR_SECTIONS)
  const [savingOrder, setSavingOrder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.featureSettings.get(selectedAccountId)
      if (res.success) {
        setFeatures(res.data.features)
        if (res.data.sidebarOrder) {
          // 保存に無いセクションは後ろに残す。機能が増えたときに
          // 新しいセクションが消えないようにするため。
          const saved = res.data.sidebarOrder.filter((s) => SIDEBAR_SECTIONS.includes(s))
          setOrder([...saved, ...SIDEBAR_SECTIONS.filter((s) => !saved.includes(s))])
        }
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (key: string, next: boolean) => {
    if (!selectedAccountId) return
    // 先に画面を変える。押した手応えが無いと、二度押しされる。
    setFeatures((prev) => ({ ...prev, [key]: next }))
    setError('')
    setNotice('')
    try {
      const res = await api.featureSettings.save(selectedAccountId, { features: { [key]: next } })
      if (!res.success) {
        setError(res.error)
        setFeatures((prev) => ({ ...prev, [key]: !next }))
        return
      }
      setNotice('保存しました')
      setTimeout(() => setNotice(''), 2000)
    } catch {
      setError('保存に失敗しました')
      setFeatures((prev) => ({ ...prev, [key]: !next }))
    }
  }

  return (
    <div>
      <Header
        title="機能設定"
        description="使わない機能を隠せます。設定はLINEアカウントごとに持ちます。"
      />

      {!selectedAccountId ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : (
        <>
          <p className="text-ink-secondary mb-4 text-sm">
            いま設定しているアカウント：
            <strong className="text-ink ml-1">
              {selectedAccount?.displayName ?? selectedAccount?.name ?? selectedAccountId}
            </strong>
          </p>

          {error && (
            <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
              {error}
            </div>
          )}
          {notice && <p className="text-success mb-4 text-sm">{notice}</p>}

          {loading ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
              読み込み中...
            </div>
          ) : (
            <div className="space-y-5">
              {FEATURE_GROUPS.map((group) => (
                <section
                  key={group.label}
                  className="bg-canvas rounded-card border-hairline border p-5"
                >
                  <h2 className="text-ink mb-3 text-sm font-semibold">{group.label}</h2>
                  <ul className="divide-hairline divide-y">
                    {group.items.map((item) => {
                      const on = features[item.key] !== false
                      return (
                        <li
                          key={item.key}
                          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="text-ink text-sm font-medium">{item.label}</p>
                            <p className="text-ink-faint text-xs">{item.note}</p>
                          </div>
                          <button
                            onClick={() => toggle(item.key, !on)}
                            role="switch"
                            aria-checked={on}
                            aria-label={`${item.label}を${on ? '無効' : '有効'}にする`}
                            className={`rounded-pill relative h-6 w-11 shrink-0 transition-colors ${
                              on ? 'bg-accent' : 'bg-hairline'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                                on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <section className="bg-canvas rounded-card border-hairline mt-5 border p-5">
            <h2 className="text-ink mb-1 text-sm font-semibold">サイドバーの並び</h2>
            <p className="text-ink-faint mb-3 text-xs">
              よく使うまとまりを上に持ってこられます。
            </p>
            <ul className="divide-hairline divide-y">
              {order.map((label, i) => (
                <li key={label} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink text-sm">
                    <span className="text-ink-faint mr-2 tabular-nums">{i + 1}.</span>
                    {label}
                  </span>
                  <div className="flex gap-1">
                    {/* 上下のボタンにしている。ドラッグは触れる範囲が小さく、
                        タッチだと持ち上げにくい。 */}
                    <button
                      onClick={() =>
                        setOrder((prev) => {
                          const next = [...prev]
                          ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                          return next
                        })
                      }
                      disabled={i === 0}
                      aria-label={`${label}を上へ`}
                      className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-xs disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() =>
                        setOrder((prev) => {
                          const next = [...prev]
                          ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                          return next
                        })
                      }
                      disabled={i === order.length - 1}
                      aria-label={`${label}を下へ`}
                      className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-xs disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!selectedAccountId) return
                  setSavingOrder(true)
                  setError('')
                  try {
                    const res = await api.featureSettings.save(selectedAccountId, {
                      sidebarOrder: order,
                    })
                    if (!res.success) {
                      setError(res.error)
                      return
                    }
                    // サイドバーは読み込み時に並びを取るので、反映には
                    // 画面の読み直しが要る。押した人に伝える。
                    setNotice('保存しました。画面を読み直すと並びが変わります。')
                  } catch {
                    setError('保存に失敗しました')
                  } finally {
                    setSavingOrder(false)
                  }
                }}
                disabled={savingOrder}
                className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {savingOrder ? '保存中...' : '並びを保存'}
              </button>
              <button
                onClick={() => setOrder(SIDEBAR_SECTIONS)}
                className="text-ink-faint hover:text-ink-secondary px-2 py-2 text-sm"
              >
                元に戻す
              </button>
            </div>
          </section>

          <p className="text-ink-faint mt-4 text-xs leading-relaxed">
            切っても、それまでに作ったデータは消えません。もう一度有効にすれば元どおり見えます。
            切った機能はサイドバーから消えますが、URLを直接開けば表示されます。
            見せたくない相手がいる場合は、ログインユーザーの役割で設定してください。
          </p>
        </>
      )}
    </div>
  )
}
