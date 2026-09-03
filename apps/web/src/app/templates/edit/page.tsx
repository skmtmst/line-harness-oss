'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'
import { useAccount } from '@/contexts/account-context'

const TYPES = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'Flex（JSON）' },
  { value: 'image', label: '画像' },
]

function TemplateEditInner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [messageType, setMessageType] = useState('text')
  const [messageContent, setMessageContent] = useState('')
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (res.success) {
          setName(res.data.name)
          setCategory(res.data.category ?? '')
          setMessageType(res.data.messageType)
          setMessageContent(res.data.messageContent)
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  const contentRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * 差し込みをカーソル位置に入れる。
   *
   * 末尾に足すだけだと、書いている途中の文の真ん中に入れられない。
   * 差し込みは文中に置くことがほとんどなので、位置を見て入れる。
   */
  const insert = (token: string) => {
    const el = contentRef.current
    if (!el) {
      setMessageContent((v) => v + token)
      return
    }
    const start = el.selectionStart ?? messageContent.length
    const end = el.selectionEnd ?? start
    const next = messageContent.slice(0, start) + token + messageContent.slice(end)
    setMessageContent(next)
    // 入れた直後にカーソルを token の後ろへ。続けて書けるようにする。
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  // LINE は約4,500文字で分割される。上限そのものではないので、超えても
  // 保存はできる。何通に分かれるかだけ伝える。
  const SPLIT_AT = 4500
  const willSplit = messageContent.length > SPLIT_AT

  const save = async () => {
    if (!id && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (!messageContent.trim()) {
      setError('中身を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = id
        ? await api.templates.update(id, { name: name.trim(), category, messageType, messageContent })
        : await api.templates.create({
            accountId: selectedAccountId!,
            name: name.trim(),
            category,
            messageType,
            messageContent,
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
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || (id ? '編集' : '作成')}</span>
      </nav>

      <div data-design="Head">
        <Header
          title={id ? 'テンプレート編集' : 'テンプレートを作る'}
          description="配信で使うメッセージを作ります。友だち情報欄や共通情報を差し込むと、一人ひとりに合わせた文面になります。"
          action={
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
          }
        />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
        <div data-design="Left" className="bg-canvas rounded-card border-hairline min-w-0 flex-1 space-y-5 border p-6">
          <Field label="テンプレート名" htmlFor="tp-name" required>
            <input
              id="tp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="フォルダ" htmlFor="tp-category" note="一覧での並びに使います。">
            <input
              id="tp-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="種類"
            htmlFor="tp-type"
            note={
              id ? '作ったあとに種類を変えると、中身の書き方も変える必要があります。' : undefined
            }
          >
            <select
              id="tp-type"
              value={messageType}
              onChange={(e) => setMessageType(e.target.value)}
              className={inputClass}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <p className="text-ink-secondary mb-1 text-sm font-medium">差し込む</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '名前', token: '{{name}}' },
                { label: '友だち情報', token: '{{field.項目名}}' },
                { label: '共通情報', token: '{{var.差し込み名}}' },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => insert(t.token)}
                  className="border-hairline text-ink-secondary rounded-pill hover:bg-canvas-sunken border px-3 py-1 text-xs"
                >
                  {t.label}
                </button>
              ))}
              {/* フォーム回答・配信日を本文に差し込む仕組みが無い。 */}
              {['フォーム回答', '配信日', 'その他'].map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  title="この差し込みは準備中です"
                  className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="中身"
            htmlFor="tp-content"
            required
            note={
              <>
                差し込みが使えます。{'{{name}}'} は友だちの表示名、
                {'{{field.差し込み名}}'} は友だち情報欄、{'{{var.差し込み名}}'} は共通情報です。
                <br />
                カルーセルを作るときは{' '}
                <Link href="/templates/carousel" className="text-accent hover:underline">
                  カルーセルの編集
                </Link>{' '}
                を使ってください。
              </>
            }
          >
            <textarea
              id="tp-content"
              ref={contentRef}
              rows={messageType === 'flex' ? 14 : 6}
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              className={`${inputClass} resize-y ${messageType === 'flex' ? 'font-mono text-xs' : ''}`}
            />
            <p className="text-ink-faint mt-1 text-xs tabular-nums">
              {messageContent.length} 文字
              {willSplit
                ? ` ・ 約${SPLIT_AT}文字を超えると複数のメッセージに分割されます`
                : ' ・ 分割なし'}
            </p>
          </Field>

          <section className="border-hairline rounded-card border p-4">
            <p className="text-ink text-sm font-semibold">本文内のURL</p>
            {/* テンプレートの本文と短縮URLを結ぶ記録が無い。配信時に短縮
                されるが、テンプレート単位のクリック数は追えない。 */}
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              配信するときにURLは自動で短縮され、クリックが記録されます。テンプレートごとのクリック数はまだ出せません。
            </p>
          </section>

          <section className="border-hairline rounded-card border p-4">
            <p className="text-ink text-sm font-semibold">送信時のアイコン・表示名</p>
            {/* 担当者名義で送る仕組みが無い。送信元は常に公式アカウント。 */}
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              いまは公式アイコンでの送信だけです。担当者名義での送信は準備中です。
            </p>
          </section>

          {error && <p className="text-danger text-sm">{error}</p>}

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
              title="テスト送信は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
            >
              テスト送信
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
        </div>

        <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <p className="text-ink text-sm font-semibold">プレビュー</p>
            <p className="text-ink-faint mt-0.5 mb-2 text-xs">差し込み後の見え方</p>
            <div className="bg-canvas-sunken rounded-card p-3">
              <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
              <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                {messageContent || '（本文がまだありません）'}
              </p>
            </div>
            {/* 差し込みは送るときに実際の値へ置き換わる。ここでは記法のまま
                出す。適当な人の値を当てはめると、その人に送るように見える。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              差し込みは送るときに実際の値に置き換わります。ここでは記法のまま出しています。
            </p>
            <p className="text-ink-faint mt-1 text-xs">URLは短縮され、クリックが計測されます</p>
          </section>
        </div>
        </div>
      )}
    </div>
  )
}

export default function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditInner />
    </Suspense>
  )
}
