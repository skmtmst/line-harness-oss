'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import QuestionEditor, {
  emptyQuestion,
  type ScenarioQuestion,
} from '@/components/scenarios/question-editor'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { TextField } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'

function displayText(value: string): string {
  return value
    .replaceAll('{{name}}', '山田 太郎')
    .replace(/\{\{field\.[^}]+\}\}/g, '登録済みの情報')
    .replace(/\{\{var\.[^}]+\}\}/g, '共通情報')
}

function questionSummary(question: ScenarioQuestion): string[] {
  const tags = question.choices.reduce((count, choice) => count + (choice.addTagIds?.length ?? 0), 0)
  const fields = question.choices.filter((choice) => choice.field?.fieldId).length
  const scenarios = question.choices.filter((choice) => choice.scenario?.op).length
  const result: string[] = []
  if (tags > 0) result.push(`タグを付ける設定 ${tags}件`)
  if (fields > 0) result.push(`友だち情報へ書く設定 ${fields}件`)
  if (scenarios > 0) result.push(`シナリオを動かす設定 ${scenarios}件`)
  return result
}

function QuestionTemplatePageInner() {
  usePageTitle('質問を作る')
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('未分類')
  const [question, setQuestion] = useState<ScenarioQuestion>(() => emptyQuestion())
  const [categories, setCategories] = useState<string[]>([])
  const [usageCount, setUsageCount] = useState(0)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedAccountId) {
      setCategories([])
      return
    }
    let cancelled = false
    void api.templates.list(undefined, selectedAccountId).then((res) => {
      if (cancelled || !res.success) return
      setCategories([...new Set(res.data.map((item) => item.category).filter(Boolean))])
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  useEffect(() => {
    if (!id || !selectedAccountId) return
    let cancelled = false
    setLoading(true)
    setError('')
    void api.templates.get(id)
      .then((template) => {
        if (cancelled) return
        if (!template.success || !template.data.question) {
          setError('質問テンプレートを読み込めませんでした。')
          return
        }
        setName(template.data.name)
        setCategory(template.data.category || '未分類')
        setQuestion(template.data.question as ScenarioQuestion)
        setUsageCount(Object.values(template.data.usedBy).reduce((total, items) => total + items.length, 0))
      })
      .catch(() => {
        if (!cancelled) setError('質問テンプレートを読み込めませんでした。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, selectedAccountId])

  const summaries = useMemo(() => questionSummary(question), [question])

  const save = async (questionStatus: 'draft' | 'published') => {
    if (!selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください。')
      return
    }
    if (!name.trim()) {
      setError('テンプレート名を入力してください。')
      return
    }
    if (!question.text.trim()) {
      setError('質問文を入力してください。')
      return
    }
    if (question.choices.length === 0 || question.choices.some((choice) => !choice.label.trim())) {
      setError('すべての選択肢に文字を入力してください。')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      accountId: selectedAccountId,
      name: name.trim(),
      category: category.trim() || '未分類',
      messageType: 'text',
      messageContent: question.intro?.trim() || question.text,
      question,
      questionStatus,
    }
    try {
      const result = id
        ? await api.templates.update(id, payload)
        : await api.templates.create(payload)
      if (!result.success) {
        setError(result.error || '保存できませんでした。')
        return
      }
      router.push('/templates')
    } catch {
      setError('保存できませんでした。通信状態を確認してもう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading || accountLoading) return <ListState kind="loading" title="質問テンプレートを読み込んでいます" />

  return (
    <div data-design-node="NNDMR" className="pb-24">
      <nav className="text-ink-faint mb-4 text-xs" aria-label="現在地">
        <Link href="/templates" className="text-accent hover:underline">テンプレート</Link>
        <span className="mx-2">›</span>
        <span className="text-accent">質問</span>
        <span className="mx-2">›</span>
        <span>{id ? '編集' : '新しく作る'}</span>
      </nav>

      {error && (
        <div role="alert" className="bg-danger-bg text-danger rounded-control text-label mb-4 px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 2xl:grid-cols-4">
        <main className="min-w-0 space-y-4 2xl:col-span-3">
          <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 lg:grid-cols-3">
            {/* 入力欄は共通部品（高さ40px・文字13px）。ここだけ余白と
                文字サイズを直に組むと、同じ画面の中で高さが揃わない。 */}
            <label className="text-label min-w-0 font-semibold text-ink-secondary lg:col-span-2">
              テンプレート名 <span className="text-danger text-caption">必須</span>
              <TextField
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className="mt-2"
                placeholder="例：継続の意思をうかがう"
              />
            </label>
            <label className="text-label font-semibold text-ink-secondary">
              フォルダ
              <TextField
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                list="question-template-folders"
                className="mt-2"
              />
              <datalist id="question-template-folders">
                {categories.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
          </section>

          <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
            <QuestionEditor value={question} onChange={setQuestion} choiceColumns />
          </section>
        </main>

        <aside className="min-w-0 space-y-3 2xl:sticky 2xl:top-4 2xl:self-start">
          <section className="rounded-card overflow-hidden bg-line-preview p-4 text-label text-on-accent">
            <h2 className="text-center font-bold">LINEプレビュー</h2>
            <p className="mx-auto mt-3 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">
              質問の見え方（山田 太郎さんの場合）
            </p>
            <div className="rounded-card mt-4 overflow-hidden bg-canvas text-ink">
              {question.intro?.trim() && (
                <p className="border-hairline border-b px-4 py-3 leading-relaxed">
                  {displayText(question.intro)}
                </p>
              )}
              <p className="border-hairline border-b px-4 py-3 font-medium leading-relaxed">
                {displayText(question.text) || '質問文を入力すると、ここに出ます。'}
              </p>
              {question.choices.map((choice, index) => (
                <div key={index} className="border-hairline border-b px-4 py-3 text-center font-semibold text-line-choice last:border-b-0">
                  {choice.label || `選択肢${index + 1}`}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-card bg-line-answer-bg p-4 text-label text-line-answer">
            <h2 className="font-bold">答えをどこに残すか</h2>
            {summaries.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {summaries.map((summary) => <li key={summary}>・{summary}</li>)}
              </ul>
            ) : (
              <p className="mt-2 leading-relaxed">選択肢の中で、タグ・友だち情報・シナリオを設定できます。</p>
            )}
          </section>

          <section className="bg-canvas border-hairline rounded-card shadow-card border p-4 text-label">
            <h2 className="font-bold text-ink">この質問を使う場所</h2>
            <p className="text-ink-secondary text-label mt-2">
              {id ? `シナリオ ${usageCount}通` : '保存後にシナリオから選べます'}
            </p>
            <Link href="/scenarios" className="text-accent mt-3 inline-block font-semibold hover:underline">
              シナリオで使う
            </Link>
          </section>
        </aside>
      </div>

      <footer className="bg-canvas border-hairline fixed inset-x-0 bottom-0 z-20 border-t px-6 py-3 lg:left-64">
        <div className="max-w-shell mx-auto flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink-faint text-xs">下書きはシナリオの選択肢に出ません。</p>
          <div className="flex flex-wrap gap-2">
            <Button href="/templates" variant="secondary">
              キャンセル
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void save('draft')}>
              下書きに保存
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save('published')}>
              {saving ? '保存中…' : 'テンプレートを保存'}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function QuestionTemplatePage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="質問テンプレートを準備しています" />}>
      <QuestionTemplatePageInner />
    </Suspense>
  )
}
