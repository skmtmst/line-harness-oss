'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { useAccount } from '@/contexts/account-context'
import {
  readInlineActions,
  toActionPayload,
  type InlineAction,
} from '@/components/auto-replies/draft-fields'

/**
 * カルーセルの編集。
 *
 * JSONを手で書かずに済むようにする。制限（LINEの決まり）を入力の
 * そばに出して、保存する前に気づけるようにしている。
 */

const MAX_COLUMNS = 10
const MAX_ACTIONS = 3
const TITLE_MAX = 40
const TEXT_MAX_WITH_IMAGE = 60
const TEXT_MAX_WITHOUT_IMAGE = 120

/** 選択肢1つぶん。 */
interface Choice {
  label: string
  /** 'uri'（URLを開く）か 'action'（押されたときに何かする）。 */
  kind: 'uri' | 'action'
  uri: string
  /** kind='action' のときに実行する並び。 */
  actions: InlineAction[]
}

interface Panel {
  thumbnailImageUrl: string
  title: string
  text: string
  actions: Choice[]
}

function emptyChoice(): Choice {
  return { label: '', kind: 'uri', uri: '', actions: [] }
}

function emptyPanel(): Panel {
  return { thumbnailImageUrl: '', title: '', text: '', actions: [emptyChoice()] }
}

function CarouselEditorInner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')

  const [name, setName] = useState('')
  const [panels, setPanels] = useState<Panel[]>([emptyPanel()])
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tapLimitMode, setTapLimitMode] = useState<'none' | 'once'>('none')
  const [tapLimitText, setTapLimitText] = useState('')
  const actionOptions = useActionOptions()

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success) return
        setName(res.data.name)
        setTapLimitMode(res.data.carouselTapLimitMode === 'once' ? 'once' : 'none')
        setTapLimitText(res.data.carouselTapLimitText ?? '')
        const storedActions = (res.data.carouselActions ?? null) as Record<
          string,
          Record<string, unknown[]>
        > | null
        try {
          const parsed = JSON.parse(res.data.messageContent) as unknown
          const columns = Array.isArray(parsed)
            ? parsed
            : ((parsed as { columns?: unknown })?.columns ?? [])
          if (Array.isArray(columns) && columns.length > 0) {
            setPanels(
              columns.map((c, i) => {
                const col = c as Partial<Panel>
                return {
                  thumbnailImageUrl: col.thumbnailImageUrl ?? '',
                  title: col.title ?? '',
                  text: col.text ?? '',
                  actions:
                    Array.isArray(col.actions) && col.actions.length > 0
                      ? (col.actions as unknown as Array<Record<string, unknown>>).map((a, ai) => {
                          const isUri = a.type === 'uri' || typeof a.uri === 'string'
                          return {
                            label: (a.label as string) ?? '',
                            kind: isUri ? ('uri' as const) : ('action' as const),
                            uri: (a.uri as string) ?? '',
                            actions: readInlineActions(
                              (storedActions?.[String(i)]?.[String(ai)] as unknown[]) ?? null,
                            ),
                          }
                        })
                      : [emptyChoice()],
                }
              }),
            )
          }
        } catch {
          // 読めない中身は空のまま。上書きするかどうかは人が決める。
          setError('いまの中身を読み取れませんでした。保存すると上書きされます。')
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  const update = (index: number, patch: Partial<Panel>) =>
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  /**
   * パネルを1つ隣と入れ替える。
   *
   * カルーセルは横に並ぶので「上下」ではなく「左右」。端では何もしない
   * （ボタン側でも押せなくしているが、キーボードから呼ばれても配列の外に
   * 出ないよう、ここでも見る）。
   */
  const move = (index: number, direction: -1 | 1) =>
    setPanels((prev) => {
      const to = index + direction
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const anyImage = panels.some((p) => p.thumbnailImageUrl.trim())
  const textMax = anyImage ? TEXT_MAX_WITH_IMAGE : TEXT_MAX_WITHOUT_IMAGE

  const save = async () => {
    if (!id && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    /*
     * 選択肢の中身を組み立てる。
     *
     * 「押されたときに何かする」を選んだ選択肢は postback になる。data には
     * どのテンプレートのどの選択肢かを入れる。**テンプレートの id は、新規作成の
     * ときまだ決まっていない**ので、いったん空で作り、id が返ってから埋めて
     * 保存し直す（下の saveWith）。
     */
    const buildContent = (templateId: string) =>
      JSON.stringify(
        panels.map((p, ci) => ({
          ...(p.thumbnailImageUrl.trim() ? { thumbnailImageUrl: p.thumbnailImageUrl.trim() } : {}),
          ...(p.title.trim() ? { title: p.title.trim() } : {}),
          text: p.text.trim(),
          actions: p.actions
            .filter((a) => a.label.trim())
            .map((a, ai) =>
              a.kind === 'action'
                ? {
                    type: 'postback',
                    label: a.label.trim(),
                    data: `ctpl=${templateId}&c=${ci}&a=${ai}`,
                  }
                : { type: 'uri', label: a.label.trim(), uri: a.uri.trim() },
            ),
        })),
      )

    // 選択肢ごとのアクションは、パネル番号 → 選択肢番号 の入れ子で持つ。
    const carouselActions: Record<string, Record<string, unknown[]>> = {}
    panels.forEach((p, ci) => {
      p.actions
        .filter((a) => a.label.trim())
        .forEach((a, ai) => {
          if (a.kind !== 'action' || a.actions.length === 0) return
          carouselActions[String(ci)] ??= {}
          carouselActions[String(ci)][String(ai)] = a.actions.map(toActionPayload)
        })
    })

    const content = buildContent(id ?? '')
    setSaving(true)
    setError('')
    try {
      // サーバー側でも同じ制限を見る。何枚目の何が問題かを返してくれる。
      const carouselOptions = {
        carouselActions: Object.keys(carouselActions).length > 0 ? carouselActions : null,
        carouselTapLimitMode: tapLimitMode,
        carouselTapLimitText: tapLimitText.trim() || null,
      }

      if (id) {
        const res = await api.templates.update(id, {
          name: name.trim(),
          messageType: 'carousel',
          messageContent: content,
          ...carouselOptions,
        })
        if (!res.success) {
          setError(res.error)
          return
        }
      } else {
        const created = await api.templates.create({
          accountId: selectedAccountId!,
          name: name.trim(),
          category: 'カルーセル',
          messageType: 'carousel',
          messageContent: content,
          ...carouselOptions,
        })
        if (!created.success) {
          setError(created.error)
          return
        }
        // id が決まったので、postback の data を埋め直す。
        // 「押されたときに何かする」選択肢が1つも無ければ、埋め直す必要はない。
        const hasPostback = panels.some((p) => p.actions.some((a) => a.kind === 'action'))
        if (hasPostback) {
          const fixed = await api.templates.update(created.data.id, {
            messageContent: buildContent(created.data.id),
          })
          if (!fixed.success) {
            setError(fixed.error)
            return
          }
        }
      }
      router.push('/templates')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || 'カルーセル'}</span>
      </nav>

      <div data-design="Head">
        <Header
          title="カルーセルの編集"
          description="画像とボタンの付いたパネルを横に並べて送ります。ボタンを押したときの動きは、アクションから選べます。"
          action={
            <button
              disabled
              title="テスト送信は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
            >
              テスト送信
            </button>
          }
        />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="max-w-3xl space-y-4">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <Field label="テンプレート名" htmlFor="cr-name" required>
              <input
                id="cr-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {/* カルーセルにフォルダを持たせる列が無い。テンプレート側の
                  category は、この画面から編集できない。 */}
              <span className="text-ink-faint">フォルダ：未分類</span>
              <span className="text-ink-faint">種別：カルーセル</span>
              <span className="text-ink tabular-nums">
                {panels.length} / {MAX_COLUMNS} パネル
              </span>
            </div>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">パネル</p>
            <p className="text-ink-faint mt-0.5 text-xs">
              左から順に表示されます。順番は下の各パネルの「←」「→」で入れ替えられます。
            </p>
            <ol className="mt-2 flex flex-wrap gap-1.5">
              {panels.map((panel, i) => (
                <li
                  key={i}
                  className="border-hairline text-ink-secondary rounded-pill border px-3 py-1 text-xs"
                >
                  パネル {i + 1}
                  {panel.title ? `：${panel.title}` : ''}
                </li>
              ))}
            </ol>
          </div>

          {panels.map((panel, i) => (
            <div key={i} className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
              <div className="flex items-center justify-between">
                <p className="text-ink text-sm font-semibold">パネル {i + 1} の内容</p>
                <div className="flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`パネル ${i + 1} を左へ移動`}
                  title={i === 0 ? 'いちばん左です' : '左へ移動'}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  ←
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === panels.length - 1}
                  aria-label={`パネル ${i + 1} を右へ移動`}
                  title={i === panels.length - 1 ? 'いちばん右です' : '右へ移動'}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  →
                </button>
                <button
                  onClick={() =>
                    setPanels((prev) =>
                      prev.length >= MAX_COLUMNS
                        ? prev
                        : [...prev.slice(0, i + 1), { ...prev[i], actions: [...prev[i].actions] }, ...prev.slice(i + 1)],
                    )
                  }
                  disabled={panels.length >= MAX_COLUMNS}
                  title={panels.length >= MAX_COLUMNS ? `パネルは${MAX_COLUMNS}枚までです` : undefined}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  複製
                </button>
                {panels.length > 1 && (
                  <button
                    onClick={() => setPanels((prev) => prev.filter((_, j) => j !== i))}
                    className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs"
                  >
                    削除
                  </button>
                )}
                </div>
              </div>

              <Field
                label="画像のURL"
                note="画像を入れるなら、全部の枚に入れてください。1枚だけ無いと、その枚だけ高さが変わって崩れます。"
              >
                <input
                  type="url"
                  value={panel.thumbnailImageUrl}
                  onChange={(e) => update(i, { thumbnailImageUrl: e.target.value })}
                  placeholder="https://example.com/a.png"
                  className={inputClass}
                />
              </Field>

              <Field label="パネルタイトル" note={`${TITLE_MAX}文字まで`}>
                <input
                  type="text"
                  value={panel.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className={inputClass}
                />
                {[...panel.title].length > TITLE_MAX && (
                  <p className="text-danger mt-1 text-xs">
                    {[...panel.title].length} 文字。{TITLE_MAX}文字までです。
                  </p>
                )}
              </Field>

              <Field
                label="パネル本文"
                required
                note={
                  anyImage
                    ? `画像があるため${TEXT_MAX_WITH_IMAGE}文字までです。`
                    : `${TEXT_MAX_WITHOUT_IMAGE}文字まで（画像を入れると${TEXT_MAX_WITH_IMAGE}文字になります）。`
                }
              >
                <textarea
                  rows={3}
                  value={panel.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  className={`${inputClass} resize-y`}
                />
                <p
                  className={`mt-1 text-xs tabular-nums ${
                    [...panel.text].length > textMax ? 'text-danger' : 'text-ink-faint'
                  }`}
                >
                  {[...panel.text].length} / {textMax}
                </p>
              </Field>

              <div>
                <p className="text-ink-secondary mb-2 text-sm font-medium">
                  ボタン（{MAX_ACTIONS}個まで）
                </p>
                {panel.actions.map((action, ai) => (
                  <div key={ai} className="border-hairline mb-2 rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={action.label}
                        onChange={(e) =>
                          update(i, {
                            actions: panel.actions.map((a, j) =>
                              j === ai ? { ...a, label: e.target.value } : a,
                            ),
                          })
                        }
                        placeholder="ボタンの文字"
                        className={`${inputClass} w-40`}
                      />
                      <div className="flex gap-1.5">
                        {(
                          [
                            { value: 'uri' as const, label: 'URLを開く' },
                            { value: 'action' as const, label: '押されたときに何かする' },
                          ]
                        ).map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() =>
                              update(i, {
                                actions: panel.actions.map((a, j) =>
                                  j === ai ? { ...a, kind: o.value } : a,
                                ),
                              })
                            }
                            className={`rounded-control px-2.5 py-1 text-xs ${action.kind === o.value ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {panel.actions.length > 1 && (
                        <button
                          onClick={() =>
                            update(i, { actions: panel.actions.filter((_, j) => j !== ai) })
                          }
                          className="text-danger hover:bg-danger-bg ml-auto rounded px-2 text-xs"
                        >
                          外す
                        </button>
                      )}
                    </div>

                    {action.kind === 'uri' ? (
                      <input
                        type="url"
                        value={action.uri}
                        onChange={(e) =>
                          update(i, {
                            actions: panel.actions.map((a, j) =>
                              j === ai ? { ...a, uri: e.target.value } : a,
                            ),
                          })
                        }
                        placeholder="https://example.com"
                        className={`${inputClass} w-full`}
                      />
                    ) : (
                      <div className="space-y-2">
                        <InlineActionList
                          actions={action.actions}
                          onChange={(next) =>
                            update(i, {
                              actions: panel.actions.map((a, j) =>
                                j === ai ? { ...a, actions: next } : a,
                              ),
                            })
                          }
                          tags={actionOptions.tags}
                          fields={actionOptions.fields}
                          marks={actionOptions.marks}
                          scenarios={actionOptions.scenarios}
                          vars={actionOptions.vars}
                        />
                        {action.actions.length === 0 && (
                          <p className="text-warning text-[11px]">
                            何も設定されていません。押されても何も起きません。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {panel.actions.length < MAX_ACTIONS && (
                  <button
                    onClick={() =>
                      update(i, { actions: [...panel.actions, emptyChoice()] })
                    }
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs"
                  >
                    ＋ ボタンを足す
                  </button>
                )}
              </div>
            </div>
          ))}

          <section className="bg-canvas rounded-card border-hairline space-y-3 border p-5">
            <div>
              <p className="text-ink text-sm font-semibold">押せる回数</p>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                「押されたときに何かする」ボタンだけが対象です。URLを開くボタンは、LINE の外へ
                出るので数えられません。
              </p>
            </div>
            <div className="space-y-1">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="tap-limit"
                  checked={tapLimitMode === 'none'}
                  onChange={() => setTapLimitMode('none')}
                  className="mt-0.5"
                />
                <span className="text-sm">何度でも押せる</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="tap-limit"
                  checked={tapLimitMode === 'once'}
                  onChange={() => setTapLimitMode('once')}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  1人につき1回だけ
                  <span className="text-ink-faint block text-[11px]">
                    このカルーセル全体で1回です。どのボタンを押しても、次からは動きません。
                  </span>
                </span>
              </label>
            </div>

            {tapLimitMode === 'once' && (
              <Field
                label="2回目に押されたときの返事"
                htmlFor="cr-limit-text"
                note="空にすると、何も返さず黙って何も起きません。"
              >
                <input
                  id="cr-limit-text"
                  type="text"
                  value={tapLimitText}
                  onChange={(e) => setTapLimitText(e.target.value)}
                  placeholder="例：こちらはすでに受け付けています。"
                  className={inputClass}
                />
              </Field>
            )}
          </section>

          {panels.length < MAX_COLUMNS && (
            <button
              onClick={() => setPanels((prev) => [...prev, emptyPanel()])}
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
            >
              パネルを追加（{panels.length} / {MAX_COLUMNS}）
            </button>
          )}

          {error && (
            <div className="bg-danger-bg border-danger-bg text-danger rounded-lg border p-4 text-sm">
              {error}
            </div>
          )}

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">届き方</p>
            <p className="text-ink-faint mt-0.5 mb-3 text-xs">横にスワイプして見えます</p>
            <div className="bg-canvas-sunken rounded-card overflow-x-auto p-3">
              <div className="flex gap-2">
                {panels.map((panel, i) => (
                  <div key={i} className="w-56 shrink-0 overflow-hidden rounded-2xl bg-white">
                    {panel.thumbnailImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={panel.thumbnailImageUrl} alt="" className="h-28 w-full object-cover" />
                    ) : (
                      <div className="bg-canvas-sunken text-ink-faint flex h-28 items-center justify-center text-xs">
                        画像なし
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-ink truncate text-sm font-medium">
                        {panel.title || '（タイトル）'}
                      </p>
                      <p className="text-ink-faint mt-1 line-clamp-2 text-xs">{panel.text}</p>
                      <div className="mt-2 space-y-1">
                        {panel.actions.map((a, j) => (
                          <p
                            key={j}
                            className="border-hairline text-accent rounded-control border px-2 py-1 text-center text-xs"
                          >
                            {a.label || '（ボタン）'}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-ink-faint mt-2 text-xs">
              {panels.length}枚のパネルを横に並べて送ります
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">ボタン別のタップ数</p>
            {/* どのボタンが押されたかを記録していない。カルーセルのアクションは
                LINE 側で処理され、こちらに戻ってこない。 */}
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              ボタンごとのタップ数はまだ取れません。リンクを開くボタンなら、短縮URLのクリックとして「分析 → URLクリック」で見られます。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">気をつけること</p>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>・パネルは{MAX_COLUMNS}枚まで。多いと最後まで見てもらえません</li>
              <li>・ボタンは1パネルにつき{MAX_ACTIONS}つまでです（LINEの仕様）</li>
              <li>・パネル本文は{TEXT_MAX_WITH_IMAGE}文字まで。超えると途中で切れて表示されます</li>
              <li>
                ・画像は横1024px以上を推奨。比率は 1.51:1 か 1:1 のどちらかに揃えてください
              </li>
              <li>・パネルごとに画像の比率が違うと、表示が崩れます</li>
            </ul>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              disabled
              title="下書き保存は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
            >
              下書き保存
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CarouselEditorPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <CarouselEditorInner />
    </Suspense>
  )
}
