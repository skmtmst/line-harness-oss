'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'

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

interface Panel {
  thumbnailImageUrl: string
  title: string
  text: string
  actions: Array<{ label: string; uri: string }>
}

function emptyPanel(): Panel {
  return { thumbnailImageUrl: '', title: '', text: '', actions: [{ label: '', uri: '' }] }
}

function CarouselEditorInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id')

  const [name, setName] = useState('')
  const [panels, setPanels] = useState<Panel[]>([emptyPanel()])
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success) return
        setName(res.data.name)
        try {
          const parsed = JSON.parse(res.data.messageContent) as unknown
          const columns = Array.isArray(parsed)
            ? parsed
            : ((parsed as { columns?: unknown })?.columns ?? [])
          if (Array.isArray(columns) && columns.length > 0) {
            setPanels(
              columns.map((c) => {
                const col = c as Partial<Panel>
                return {
                  thumbnailImageUrl: col.thumbnailImageUrl ?? '',
                  title: col.title ?? '',
                  text: col.text ?? '',
                  actions:
                    Array.isArray(col.actions) && col.actions.length > 0
                      ? col.actions.map((a) => ({ label: a.label ?? '', uri: (a as { uri?: string }).uri ?? '' }))
                      : [{ label: '', uri: '' }],
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

  const anyImage = panels.some((p) => p.thumbnailImageUrl.trim())
  const textMax = anyImage ? TEXT_MAX_WITH_IMAGE : TEXT_MAX_WITHOUT_IMAGE

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    const content = JSON.stringify(
      panels.map((p) => ({
        ...(p.thumbnailImageUrl.trim() ? { thumbnailImageUrl: p.thumbnailImageUrl.trim() } : {}),
        ...(p.title.trim() ? { title: p.title.trim() } : {}),
        text: p.text.trim(),
        actions: p.actions
          .filter((a) => a.label.trim())
          .map((a) => ({ type: 'uri', label: a.label.trim(), uri: a.uri.trim() })),
      })),
    )
    setSaving(true)
    setError('')
    try {
      // サーバー側でも同じ制限を見る。何枚目の何が問題かを返してくれる。
      const res = id
        ? await api.templates.update(id, {
            name: name.trim(),
            messageType: 'carousel',
            messageContent: content,
          })
        : await api.templates.create({
            name: name.trim(),
            category: 'カルーセル',
            messageType: 'carousel',
            messageContent: content,
          })
      if (!res.success) {
        setError(res.error)
        return
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
      <Header
        title="カルーセルの編集"
        description="横に並べて見せるメッセージです。左右に振って読んでもらいます。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">›</span>
        <span>カルーセル</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="max-w-3xl space-y-4">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <Field label="名前" htmlFor="cr-name" required>
              <input
                id="cr-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {panels.map((panel, i) => (
            <div key={i} className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
              <div className="flex items-center justify-between">
                <p className="text-ink text-sm font-semibold">{i + 1}枚目</p>
                {panels.length > 1 && (
                  <button
                    onClick={() => setPanels((prev) => prev.filter((_, j) => j !== i))}
                    className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs"
                  >
                    この枚を外す
                  </button>
                )}
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

              <Field label="タイトル" note={`${TITLE_MAX}文字まで`}>
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
                label="本文"
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
                  <div key={ai} className="mb-2 flex flex-wrap gap-2">
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
                      className={`${inputClass} min-w-[12rem] flex-1`}
                    />
                    {panel.actions.length > 1 && (
                      <button
                        onClick={() =>
                          update(i, { actions: panel.actions.filter((_, j) => j !== ai) })
                        }
                        className="text-danger hover:bg-danger-bg rounded px-2 text-xs"
                      >
                        外す
                      </button>
                    )}
                  </div>
                ))}
                {panel.actions.length < MAX_ACTIONS && (
                  <button
                    onClick={() =>
                      update(i, { actions: [...panel.actions, { label: '', uri: '' }] })
                    }
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs"
                  >
                    ＋ ボタンを足す
                  </button>
                )}
              </div>
            </div>
          ))}

          {panels.length < MAX_COLUMNS && (
            <button
              onClick={() => setPanels((prev) => [...prev, emptyPanel()])}
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
            >
              ＋ 枚を足す（{panels.length} / {MAX_COLUMNS}）
            </button>
          )}

          {error && (
            <div className="bg-danger-bg border-danger-bg text-danger rounded-lg border p-4 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
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
