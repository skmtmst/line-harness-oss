'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { FriendField, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/form-controls'

/**
 * 回答フォーム編集（設計 V2 6-3-1）。
 *
 * 設計は「ブロックの一覧 → 選んだブロックの設定 → プレビュー」の3枚並び。
 * ブロックの中身は forms.fields のJSONにそのまま入るので、種類・タイトル・
 * 説明文・必須・登録先・並び順は本当に編集できる。
 *
 * `name` は回答データの見出しになるので、作ったあとは変えない。ここを
 * 変えると、それまでの回答と結びつかなくなる。
 */

/** 設計に出ているブロックの種類。値は回答を受け取る側と合わせてある。 */
const BLOCK_TYPES = [
  { value: 'heading', label: '見出し', note: '区切りの文字だけを出します' },
  { value: 'text', label: '単一行', note: '短い文字' },
  { value: 'textarea', label: '複数行', note: '長い文章' },
  { value: 'tel', label: '電話番号', note: '数字だけ' },
  { value: 'email', label: 'メールアドレス', note: '' },
  { value: 'number', label: '数値', note: '体重など' },
  { value: 'date', label: '日付', note: 'カレンダーから選びます' },
  { value: 'select', label: '選択', note: '用意した中から1つ' },
]

interface FormFieldDef {
  id?: string
  /** 回答データの見出し。作ったあとは変えない。 */
  name?: string
  label?: string
  type?: string
  required?: boolean
  hidden?: boolean
  description?: string
  defaultValue?: string
  /** 選択のときの候補。改行区切りで持つ。 */
  options?: string[]
  /** 回答の登録先。友だち情報欄の項目ID */
  friendFieldId?: string | null
}

const typeLabel = (t?: string) => BLOCK_TYPES.find((b) => b.value === t)?.label ?? (t ?? '単一行')

/** 表示名から、回答データの見出しになる英数字のキーを作る。 */
function suggestName(index: number): string {
  return `field_${index + 1}_${Math.abs(index * 2654435761) % 1000}`
}

function FormEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<FormFieldDef[]>([])
  const [selected, setSelected] = useState(0)
  const [onSubmitTagId, setOnSubmitTagId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [submitCount, setSubmitCount] = useState(0)
  const [tags, setTags] = useState<Tag[]>([])
  const [friendFields, setFriendFields] = useState<FriendField[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [tagRes, ffRes] = await Promise.all([api.tags.list(), api.friendFields.list()])
        if (tagRes.success) setTags(tagRes.data)
        if (ffRes.success) setFriendFields(ffRes.data)
        if (!id) return
        const res = await api.forms.get(id)
        if (res.success) {
          setName(res.data.name)
          setDescription(res.data.description ?? '')
          setOnSubmitTagId(res.data.onSubmitTagId ?? '')
          setIsActive(res.data.isActive)
          setSubmitCount(res.data.submitCount ?? 0)
          const raw = res.data.fields
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          setFields(Array.isArray(parsed) ? (parsed as FormFieldDef[]) : [])
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const patch = (i: number, updates: Partial<FormFieldDef>) =>
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...updates } : f)))

  const move = (i: number, delta: number) =>
    setFields((prev) => {
      const to = i + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(i, 1)
      next.splice(to, 0, row)
      setSelected(to)
      return next
    })

  const addBlock = () =>
    setFields((prev) => {
      const next = [
        ...prev,
        { name: suggestName(prev.length), label: '新しい項目', type: 'text' as const },
      ]
      setSelected(next.length - 1)
      return next
    })

  const removeBlock = (i: number) =>
    setFields((prev) => {
      const next = prev.filter((_, j) => j !== i)
      setSelected(Math.max(0, Math.min(i, next.length - 1)))
      return next
    })

  const save = async () => {
    if (!name.trim()) {
      setError('フォーム名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.update(id, {
        name: name.trim(),
        description: description.trim() || null,
        fields,
        onSubmitTagId: onSubmitTagId || null,
        isActive,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setNotice('保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!id) {
    return (
      <div>
        <Header title="回答フォーム編集" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          フォームが指定されていません。
          <Link href="/form-submissions" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  const current = fields[selected]

  return (
    <div>
      <nav className="text-ink-faint mb-2 text-xs" data-design="Crumb">
        <Link href="/form-submissions" className="hover:underline">
          回答フォーム
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || '（名前なし）'}</span>
      </nav>

      <div data-design="Head">
        <Header
          title="回答フォーム編集"
          description="ブロックを積んでフォームを作ります。各項目の回答は、指定した友だち情報欄にそのまま記録されます。"
          action={
            <div className="flex flex-wrap gap-2">
              {['マニュアル', '下書き保存', 'デザイン設定'].map((label) => (
                <button
                  key={label}
                  disabled
                  title="準備中です"
                  className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={save}
                disabled={saving}
                className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              >
                {saving ? '保存中...' : 'フォームを保存'}
              </button>
            </div>
          }
        />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          <div
            data-design="Meta"
            className="bg-canvas rounded-card border-hairline mb-4 grid gap-4 border p-4 sm:grid-cols-2 xl:grid-cols-5"
          >
            <Field label="フォーム名" htmlFor="fm-name" required>
              <input
                id="fm-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>

            {/* forms にフォルダを持つ列が無い。 */}
            <Field label="フォルダ" note="フォルダ分けは、まだ保存する場所がありません。">
              <select disabled className={`${inputClass} opacity-50`}>
                <option>未分類</option>
              </select>
            </Field>

            <Field label="公開状態" htmlFor="fm-active">
              <select
                id="fm-active"
                value={isActive ? '1' : '0'}
                onChange={(e) => setIsActive(e.target.value === '1')}
                className={inputClass}
              >
                <option value="1">公開中</option>
                <option value="0">停止中</option>
              </select>
            </Field>

            {/* 友だちが入力する画面がこの中に無い。URLを出すと、開けないものを配ることになる。 */}
            <Field label="回答用URL" note="友だちが入力する画面が、この管理システムの中にありません。">
              <p className="text-ink-faint rounded-control border-hairline border px-3 py-2 text-sm">
                —
              </p>
            </Field>

            <div>
              <p className="text-ink-faint text-xs">回答</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {submitCount}
                <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(0,1.4fr)_minmax(240px,1fr)]">
            {/* ---- ブロックの一覧 ---- */}
            <section data-design="Blocks" className="bg-canvas rounded-card border-hairline border">
              <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-ink text-sm font-bold">ブロック</h2>
                <span className="text-ink-faint text-xs tabular-nums">{fields.length}</span>
              </div>
              <ol className="divide-hairline divide-y">
                {fields.map((f, i) => (
                  <li key={f.id ?? i}>
                    <div
                      className={`flex items-center gap-2 px-3 py-2 ${
                        i === selected ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <button
                        onClick={() => setSelected(i)}
                        className="min-w-0 flex-1 text-left"
                        aria-current={i === selected}
                      >
                        <span className="text-ink-faint mr-2 text-xs tabular-nums">{i + 1}</span>
                        <span className="text-ink-faint text-xs">{typeLabel(f.type)}</span>
                        <span className="text-ink block truncate text-sm font-medium">
                          {f.label ?? f.name ?? `項目${i + 1}`}
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col">
                        <button
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label="上へ"
                          className="text-ink-faint hover:text-ink px-1 text-xs disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => move(i, 1)}
                          disabled={i === fields.length - 1}
                          aria-label="下へ"
                          className="text-ink-faint hover:text-ink px-1 text-xs disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-hairline border-t p-3">
                <button
                  onClick={addBlock}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control w-full border border-dashed px-3 py-2 text-sm font-medium"
                >
                  ブロックを追加
                </button>
              </div>
            </section>

            {/* ---- 選んだブロックの設定 ---- */}
            <section
              data-design="Inspector"
              className="bg-canvas rounded-card border-hairline space-y-4 border p-4"
            >
              {!current ? (
                <p className="text-ink-faint text-sm">
                  ブロックがありません。「ブロックを追加」から作れます。
                </p>
              ) : (
                <>
                  <Field label="タイプ" htmlFor="bk-type">
                    <select
                      id="bk-type"
                      value={current.type ?? 'text'}
                      onChange={(e) => patch(selected, { type: e.target.value })}
                      className={inputClass}
                    >
                      {BLOCK_TYPES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                          {b.note ? ` — ${b.note}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="タイトル" htmlFor="bk-label" required>
                    <input
                      id="bk-label"
                      type="text"
                      value={current.label ?? ''}
                      onChange={(e) => patch(selected, { label: e.target.value })}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="説明文" htmlFor="bk-desc" note="入力欄の下に小さく出ます。">
                    <input
                      id="bk-desc"
                      type="text"
                      value={current.description ?? ''}
                      onChange={(e) => patch(selected, { description: e.target.value })}
                      placeholder="例：西暦でご入力ください"
                      className={inputClass}
                    />
                  </Field>

                  {current.type === 'select' && (
                    <Field label="選べるもの" htmlFor="bk-options" note="1行に1つ書きます。">
                      <textarea
                        id="bk-options"
                        rows={4}
                        value={(current.options ?? []).join('\n')}
                        onChange={(e) =>
                          patch(selected, {
                            options: e.target.value.split('\n').filter((v) => v.trim() !== ''),
                          })
                        }
                        placeholder={'犬\n猫\nその他'}
                        className={`${inputClass} resize-y`}
                      />
                    </Field>
                  )}

                  {current.type !== 'heading' && (
                    <>
                      <Field label="初期値" htmlFor="bk-default">
                        <input
                          id="bk-default"
                          type="text"
                          value={current.defaultValue ?? ''}
                          onChange={(e) => patch(selected, { defaultValue: e.target.value })}
                          className={inputClass}
                        />
                      </Field>

                      <Field
                        label="回答の登録先"
                        htmlFor="bk-ff"
                        note="友だち情報欄で定義した項目から選びます。決めると、友だち詳細に出てテンプレートで差し込めます。"
                      >
                        <select
                          id="bk-ff"
                          value={current.friendFieldId ?? ''}
                          onChange={(e) =>
                            patch(selected, { friendFieldId: e.target.value || null })
                          }
                          className={inputClass}
                        >
                          <option value="">— 情報欄に入れない —</option>
                          {friendFields.map((ff) => (
                            <option key={ff.id} value={ff.id}>
                              {ff.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {/* 設計は「複数可」。いまは項目ひとつにつき登録先ひとつ。 */}
                      <p className="text-ink-faint text-xs leading-relaxed">
                        登録先はひとつだけ選べます。ECが正になっている項目には書き込まれません（次のEC同期で戻ってしまうため）。
                      </p>

                      <div className="flex flex-wrap gap-4">
                        <label className="text-ink-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={current.required ?? false}
                            onChange={(e) => patch(selected, { required: e.target.checked })}
                          />
                          必須
                        </label>
                        <label className="text-ink-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={current.hidden ?? false}
                            onChange={(e) => patch(selected, { hidden: e.target.checked })}
                          />
                          非表示
                        </label>
                      </div>
                    </>
                  )}

                  {/* リマインダを日付から起こす結び付けが無い。 */}
                  {current.type === 'date' && (
                    <label className="text-ink-faint flex items-start gap-2 text-sm">
                      <input type="checkbox" disabled className="mt-0.5" />
                      <span>
                        この日付からリマインダを起動する
                        <span className="block text-xs">
                          誕生日クーポンなどに使う設定ですが、フォームの日付とリマインダを結ぶ場所がまだありません。
                        </span>
                      </span>
                    </label>
                  )}

                  <div className="border-hairline flex items-center justify-between border-t pt-3">
                    <span className="text-ink-faint text-xs">
                      回答データの見出し：{current.name ?? '（未設定）'}
                    </span>
                    <button
                      onClick={() => removeBlock(selected)}
                      className="text-danger text-xs hover:underline"
                    >
                      このブロックを削除
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* ---- プレビュー ---- */}
            <section
              data-design="Preview"
              className="bg-canvas rounded-card border-hairline border p-4"
            >
              <h2 className="text-ink mb-3 text-sm font-bold">プレビュー</h2>
              <div className="border-hairline rounded-card space-y-3 border p-3">
                <p className="text-ink text-sm font-bold">{name || '（名前なし）'}</p>
                {description && (
                  <p className="text-ink-secondary text-xs leading-relaxed">{description}</p>
                )}
                {fields
                  .filter((f) => !f.hidden)
                  .map((f, i) =>
                    f.type === 'heading' ? (
                      <p key={i} className="text-ink border-hairline border-t pt-3 text-sm font-bold">
                        {f.label}
                      </p>
                    ) : (
                      <div key={i}>
                        <p className="text-ink-secondary text-xs font-medium">
                          {f.label}
                          {f.required && (
                            <span className="text-danger ml-1 text-[10px]">必須</span>
                          )}
                        </p>
                        <div className="border-hairline text-ink-faint rounded-control mt-1 border px-2 py-1.5 text-xs">
                          {f.defaultValue ||
                            (f.type === 'select'
                              ? (f.options ?? []).join(' / ') || '選んでください'
                              : f.type === 'date'
                                ? '日付を選択'
                                : '　')}
                        </div>
                        {f.description && (
                          <p className="text-ink-faint mt-0.5 text-[11px]">{f.description}</p>
                        )}
                      </div>
                    ),
                  )}
              </div>
            </section>
          </div>

          <div className="bg-canvas rounded-card border-hairline mt-4 max-w-3xl space-y-4 border p-4">
            <Field label="説明" htmlFor="fm-desc" note="フォームの冒頭に出ます。">
              <textarea
                id="fm-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${inputClass} resize-y`}
              />
            </Field>

            <Field
              label="回答したときに付けるタグ"
              htmlFor="fm-tag"
              note="このフォームに答えた人を、あとから絞り込めるようになります。"
            >
              <select
                id="fm-tag"
                value={onSubmitTagId}
                onChange={(e) => setOnSubmitTagId(e.target.value)}
                className={inputClass}
              >
                <option value="">— 付けない —</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>

            {error && <p className="text-danger text-sm">{error}</p>}
            {notice && <p className="text-success text-sm">{notice}</p>}
          </div>
        </>
      )}
    </div>
  )
}

export default function FormEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FormEditInner />
    </Suspense>
  )
}
