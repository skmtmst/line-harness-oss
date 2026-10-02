'use client'

/*
 * ★V8「質問を作る／編集」（Pencil l87p1J）。
 *
 * 左に積む白いカード：名前とフォルダ／質問（前文・質問文・答え方・選択肢は
 * 共有の QuestionEditor が受け持つ）。
 * 右の欄：「答えをどこに残すか」＋「この質問を使う場所」＋届き方。
 * 下の追従バー：キャンセル／下書きを保存／保存して公開。
 *
 * 読み込み・保存（questionStatus）・離脱番兵の判断は v7（questions/new/page.tsx）
 * と同じ口を使う。ここにあるのは置き場と見え方だけ。
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { describeApiFailure, isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import QuestionEditor, {
  emptyQuestion,
  type ScenarioQuestion,
} from '@/components/scenarios/question-editor'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import LinePreview from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { Field, inputClass } from '@/components/shared/form-controls'
import type { Folder } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import EditorV8, { EditorCard } from '../editor-v8'
import styles from '../editor-v8.module.css'

function displayText(value: string): string {
  return value
    .replaceAll('{{name}}', '山田 太郎')
    .replace(/\{\{field\.[^}]+\}\}/g, '登録済みの情報')
    .replace(/\{\{var\.[^}]+\}\}/g, '共通情報')
}

/* v7 と同じ番人：口から来た質問が編集器の形かを確かめる。 */
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

function snapshotOf(value: { name: string; category: string; folderId: string | null; question: ScenarioQuestion }): string {
  return JSON.stringify(value)
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

function QuestionTemplateV8Inner() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('未分類')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [templateAccountId, setTemplateAccountId] = useState<string | null>(null)
  const [initialQuestion] = useState<ScenarioQuestion>(() => emptyQuestion())
  const [question, setQuestion] = useState<ScenarioQuestion>(initialQuestion)
  const [usageCount, setUsageCount] = useState(0)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  /** 「保存して公開」の使用先確認窓。 */
  const [publishConfirm, setPublishConfirm] = useState(false)
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (cancelled || !res.success) return
      setFolders(res.data)
    }).catch(() => {})
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
        setSavedSnapshot(snapshotOf({
          name: template.data.name,
          category: template.data.category || '未分類',
          folderId: template.data.folderId ?? null,
          question: template.data.question,
        }))
        setUsageCount(Object.values(template.data.usedBy).reduce((total, items) => total + items.length, 0))
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(isForbiddenOrRateLimited(caught) ? loadFailureNotice(caught, '質問テンプレート') : '質問テンプレートを読み込めませんでした。')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, selectedAccountId])

  const summaries = useMemo(() => questionSummary(question), [question])

  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => snapshotOf({
    name: '',
    category: '未分類',
    folderId: null as string | null,
    question: initialQuestion,
  }))
  const dirty = snapshotOf({ name, category, folderId, question }) !== savedSnapshot

  /** 保存する。質問は公開も questionStatus の一部として保存する。 */
  const save = async (questionStatus: 'draft' | 'published'): Promise<boolean> => {
    if (!selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください。')
      return false
    }
    if (!name.trim()) {
      setError('テンプレート名を入力してください。')
      return false
    }
    if (!question.text.trim()) {
      setError('質問文を入力してください。')
      return false
    }
    if (question.choices.length === 0 || question.choices.some((choice) => !choice.label.trim())) {
      setError('すべての選択肢に文字を入力してください。')
      return false
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
        return false
      }
      return true
    } catch (caught) {
      setError(describeApiFailure(caught, '保存', { forbidden: '質問テンプレートの作成・変更はオーナーと管理者だけができます。' }))
      return false
    } finally {
      setSaving(false)
    }
  }

  const onSaveDraft = async () => {
    const ok = await save('draft')
    if (ok) router.push('/templates')
  }

  /*
   * 保存して公開。使われている質問を公開すると利用先へ新しい内容が届くので、
   * 使用先があるときは確認窓を挟む（Pencil cuR8I と同じ考え方）。
   */
  const onPublish = async () => {
    if (id && usageCount > 0) {
      setPublishConfirm(true)
      return
    }
    setPublishing(true)
    try {
      const ok = await save('published')
      if (ok) router.push('/templates')
    } finally {
      setPublishing(false)
    }
  }

  if (loading || accountLoading) return <ListState kind="loading" title="質問テンプレートを読み込んでいます" />

  if (!canMutateTemplates) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <Link href="/templates" className={styles.back}>テンプレートへ</Link>
        </header>
        <div role="alert" className={styles.card}>
          <p className={styles.cardTitle}>質問テンプレートの作成・変更はオーナーと管理者だけができます</p>
          <Link href="/templates" className="text-action text-sm underline">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <EditorV8
        title={id ? '質問を編集' : '質問を作る'}
        lead="ボタンで答えてもらい、答えでタグなどを付ける"
        designNode="l87p1J"
        dirty={dirty}
        dirtySubject="質問への変更"
        saving={saving}
        publishing={publishing}
        status="下書きはシナリオの選択肢に出ません。"
        onSaveDraft={() => void onSaveDraft()}
        onPublish={() => void onPublish()}
        error={error || undefined}
        guide={(
          <>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>答えをどこに残すか</h2>
              </div>
              {summaries.length > 0 ? (
                <ul className={styles.guideList}>
                  {summaries.map((summary) => <li key={summary} className={styles.guideDesc}>・{summary}</li>)}
                </ul>
              ) : (
                <p className={styles.muted}>選択肢の中で、タグ・友だち情報・シナリオを設定できます。</p>
              )}
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>この質問を使う場所</h2>
              </div>
              <p className={styles.muted}>
                {id ? `使用先 ${usageCount}か所` : '保存すると、一斉配信・シナリオから選べます。'}
              </p>
            </section>
          </>
        )}
        preview={(
          <LinePreview note="質問の見え方（山田 太郎さんの場合）" caption="配信日 10:00">
            <div className="rounded-card overflow-hidden bg-canvas text-ink">
              {question.intro?.trim() ? (
                <p className="border-hairline border-b px-4 py-3 leading-relaxed">
                  {displayText(question.intro)}
                </p>
              ) : null}
              <p className="border-hairline border-b px-4 py-3 font-medium leading-relaxed">
                {displayText(question.text) || '質問文を入力すると、ここに出ます。'}
              </p>
              {question.choices.map((choice, index) => (
                <div key={index} className="border-hairline text-line-choice border-b px-4 py-3 text-center font-semibold last:border-b-0">
                  {choice.label || `選択肢${index + 1}`}
                </div>
              ))}
            </div>
          </LinePreview>
        )}
      >
        <EditorCard title="名前とフォルダ" note="一覧に出る名前です。友だちには見えません。">
          <div className={styles.fieldRow}>
            <Field label="テンプレート名" htmlFor="tq8-name" required>
              <input
                id="tq8-name"
                type="text"
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="例：継続の意思をうかがう"
              />
            </Field>
            <Field label="フォルダ" htmlFor="tq8-folder">
              <Select
                id="tq8-folder"
                aria-label="フォルダ"
                value={folderId ?? ''}
                onChange={(value) => {
                  const next = value || null
                  setFolderId(next)
                  setCategory(folders.find((folder) => folder.id === next)?.name ?? '未分類')
                }}
                options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
              />
            </Field>
          </div>
        </EditorCard>

        <EditorCard title="質問" note="答えをどこに残すかを、選択肢ごとに決めます">
          <QuestionEditor value={question} onChange={setQuestion} choiceColumns />
        </EditorCard>
      </EditorV8>

      <ConfirmDialog
        open={publishConfirm}
        title="この質問を公開しますか？"
        description={`この質問は ${usageCount}か所で使われています。公開すると、シナリオや一斉配信へ新しい内容が届きます。`}
        confirmLabel="公開する"
        busy={saving}
        error={error || undefined}
        designNode="cuR8I"
        onConfirm={async () => {
          setPublishing(true)
          try {
            const ok = await save('published')
            if (ok) {
              setPublishConfirm(false)
              router.push('/templates')
            }
          } finally {
            setPublishing(false)
          }
        }}
        onCancel={() => setPublishConfirm(false)}
      />
    </>
  )
}

export default function QuestionTemplateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="質問テンプレートを準備しています" />}>
      <QuestionTemplateV8Inner />
    </Suspense>
  )
}
