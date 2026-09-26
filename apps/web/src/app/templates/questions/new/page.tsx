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
import LinePreview from '@/components/shared/line-preview'
import StickyBar from '@/components/shared/sticky-bar'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import type { Folder } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'

function displayText(value: string): string {
  return value
    .replaceAll('{{name}}', '山田 太郎')
    .replace(/\{\{field\.[^}]+\}\}/g, '登録済みの情報')
    .replace(/\{\{var\.[^}]+\}\}/g, '共通情報')
}

/*
 * 口から来た質問が編集器の形かを確かめる（#497 軽7）。
 * `as` で通すと、項目が増えたときのずれに気づけない。
 * 形が違うものは読み込まず、読込エラーにする。
 */
function isEditableQuestion(value: unknown): value is ScenarioQuestion {
  if (!value || typeof value !== 'object') return false
  const question = value as Record<string, unknown>
  if (typeof question.text !== 'string') return false
  if (question.tapMode !== 'single' && question.tapMode !== 'multiple') return false
  if (!Array.isArray(question.choices)) return false
  return question.choices.every((choice) =>
    !!choice
    && typeof choice === 'object'
    && typeof (choice as Record<string, unknown>).label === 'string')
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
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('未分類')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  // 編集時はテンプレートが属するアカウント。選択中と食い違うことがある（N-147）。
  const [templateAccountId, setTemplateAccountId] = useState<string | null>(null)
  const [question, setQuestion] = useState<ScenarioQuestion>(() => emptyQuestion())
  const [usageCount, setUsageCount] = useState(0)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // N-144: 質問テンプレートの作成・編集APIも owner/admin だけ。staff へは
  // フォームを出さず、保存まで辿り着けないようにする。
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  usePageTitle(canMutateTemplates ? '質問を作る' : '質問テンプレート')

  // 置き場は「編集しているテンプレートのアカウント」のものだけを出す。
  // 読み替えるまで前のアカウントの帯は残さない（N-147）。
  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (cancelled || !res.success) return
      setFolders(res.data)
    })
    return () => { cancelled = true }
  }, [folderAccountId])

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
        setTemplateAccountId(template.data.accountId ?? null)
        setCategory(template.data.category || '未分類')
        setFolderId(template.data.folderId ?? null)
        if (!isEditableQuestion(template.data.question)) {
          setError('質問テンプレートを読み込めませんでした。')
          return
        }
        setQuestion(template.data.question)
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
      folderId,
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

  if (!canMutateTemplates) {
    return (
      <div className="pb-24">
        <nav className="text-ink-faint mb-4 text-xs" aria-label="現在地">
          <Link href="/templates" className="text-action underline">テンプレート</Link>
          <span className="mx-2">›</span>
          <span className="text-ink">質問</span>
        </nav>
        <div role="alert" className="bg-canvas rounded-card border-hairline border p-8 text-sm">
          <p className="font-bold text-ink">質問テンプレートの作成・変更はオーナーと管理者だけができます</p>
          <Link href="/templates" className="text-action underline mt-3 inline-block text-sm">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <div data-design-node="NNDMR" className="pb-24">
      <nav className="text-ink-faint mb-4 text-xs" aria-label="現在地">
        <Link href="/templates" className="text-action underline">テンプレート</Link>
        <span className="mx-2">›</span>
        <span className="text-ink">質問</span>
        <span className="mx-2">›</span>
        <span>{id ? '編集' : '新しく作る'}</span>
      </nav>

      {error && (
        <div role="alert" className="bg-danger-bg text-danger rounded-control text-label mb-4 px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 2xl:grid-cols-4">
        <div className="min-w-0 space-y-4 2xl:col-span-3">
          <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 lg:grid-cols-3">
            {/* 入力欄は共通部品。#976 U086: 必須の印は Field の required（
                「必須」札）にそろえ、独自の赤字テキストは置かない。 */}
            <div className="min-w-0 lg:col-span-2">
              <Field label="テンプレート名" htmlFor="tq-name" required>
                <TextField
                  id="tq-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  placeholder="例：継続の意思をうかがう"
                />
              </Field>
            </div>
            {/*
              U057: 置き場はこの1か所だけ。以前は「フォルダ」の自由記入欄が
              別にあり、そこへ名前を打ち込んでも一覧の帯には載らず、
              置き場を選んだつもりになる失敗があった。category（保存値）は
              選んだ置き場の名前をそのまま入れて、ずれないようにする。
            */}
            <Field label="置き場" htmlFor="tq-folder">
              <SelectField
                id="tq-folder"
                aria-label="置き場"
                value={folderId ?? ''}
                onChange={(event) => {
                  const next = event.target.value || null
                  setFolderId(next)
                  setCategory(folders.find((folder) => folder.id === next)?.name ?? '未分類')
                }}
                options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
              />
            </Field>
          </section>

          <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
            <QuestionEditor value={question} onChange={setQuestion} choiceColumns />
          </section>
        </div>

        <aside className="min-w-0 space-y-3 2xl:sticky 2xl:top-4 2xl:self-start">
          <LinePreview note="質問の見え方（山田 太郎さんの場合）">
            <div className="rounded-card overflow-hidden bg-canvas text-ink">
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
          </LinePreview>

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
              {id ? `使用先 ${usageCount}か所` : '保存後にシナリオから選べます'}
            </p>
            <Link href="/scenarios" className="text-action mt-3 inline-block font-semibold underline">
              シナリオで使う
            </Link>
          </section>
        </aside>
      </div>

      <StickyBar
        status="下書きはシナリオの選択肢に出ません。"
        actions={(
          <>
            <Button href="/templates" variant="secondary">
              キャンセル
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void save('draft')}>
              下書きに保存
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save('published')}>
              {saving ? '保存中…' : 'テンプレートを保存'}
            </Button>
          </>
        )}
      />
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
