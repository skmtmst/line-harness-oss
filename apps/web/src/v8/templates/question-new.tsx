'use client'

/*
 * ★V8 テンプレート「質問を作る・編集」（Pencil `l87p1J`）。
 *
 * 外枠はテンプレートの作る画面と同じ（src/v8/template-edit/frame）。左に段「名前とフォルダ」「質問」「選択肢」、
 * 右の列に「この質問を使う場所」と「届き方」（本物のスマホ）。下の帯はキャンセル・下書きを保存・保存して公開。
 * 読み込み・保存・公開（使用先があれば確認の窓）・離れる確認は今の V8（app/templates/questions/question-v8.tsx）と同じ。
 * 見せ方を絵に合わせた：選択肢は横に並ぶカード（ボタンの文字・押されたら・押したときの返信）。
 * 「押されたら」は今の質問の部品（QuestionEditor）を窓で開いて決める（タグ・友だち情報・シナリオ・URL などの全部の設定が残る）。
 * 受け付ける URL：`/templates/questions/new`・`?id=<テンプレート>`（直す）。
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Plus, Send } from 'lucide-react'
import type { Folder, Scenario, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { describeApiFailure, isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import QuestionEditor, { emptyQuestion, newChoiceKey, type QuestionChoice, type ScenarioQuestion } from '@/components/scenarios/question-editor'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { TemplateEditFrame } from '../template-edit/frame'
import type { TemplateEditHost } from '../template-edit/host'
import te from '../template-edit/edit.module.css'
import styles from './question-new.module.css'

const MAX_CHOICES = 4

function displayText(value: string): string {
  return value
    .replaceAll('{{name}}', '山田 太郎')
    .replace(/\{\{field\.[^}]+\}\}/g, '登録済みの情報')
    .replace(/\{\{var\.[^}]+\}\}/g, '共通情報')
}

/* 口から来た質問が編集器の形かを確かめる（今と同じ番人）。 */
function isEditableQuestion(value: unknown): value is ScenarioQuestion {
  if (!value || typeof value !== 'object') return false
  const question = value as Record<string, unknown>
  if (typeof question.text !== 'string') return false
  if (question.tapMode !== 'single' && question.tapMode !== 'multiple') return false
  if (!Array.isArray(question.choices)) return false
  return question.choices.every((choice) => !!choice && typeof choice === 'object' && typeof (choice as Record<string, unknown>).label === 'string')
}

const snapshotOf = (value: { name: string; category: string; folderId: string | null; question: ScenarioQuestion }) => JSON.stringify(value)

/** 「押されたら」に出す1行（絵：「タグ「継続」を付ける」「シナリオ「解約フォロー」を始める」）。 */
export function choiceActionText(choice: QuestionChoice, tags: Array<Pick<Tag, 'id' | 'name'>>, scenarios: Array<Pick<Scenario, 'id' | 'name'>>): string {
  const parts: string[] = []
  const tagNames = (choice.addTagIds ?? []).map((id) => tags.find((tag) => tag.id === id)?.name ?? 'タグ')
  if (tagNames.length) parts.push(`タグ「${tagNames[0]}」を付ける${tagNames.length > 1 ? ` ほか${tagNames.length - 1}` : ''}`)
  if (choice.removeTagIds?.length) parts.push(`タグを${choice.removeTagIds.length}つ外す`)
  if (choice.field?.fieldId) parts.push('友だち情報に書く')
  if (choice.scenario?.op === 'start') {
    const name = scenarios.find((item) => item.id === choice.scenario?.scenarioId)?.name
    parts.push(name ? `シナリオ「${name}」を始める` : 'シナリオを始める')
  }
  if (choice.scenario?.op === 'stop') parts.push('シナリオを止める')
  const behavior: Partial<Record<QuestionChoice['behavior'], string>> = {
    url: 'URLを開く', tel: '電話をかける', add_friend: '友だち追加へ', mail: 'メールを送る', form: '回答フォームを開く',
  }
  if (behavior[choice.behavior]) parts.push(behavior[choice.behavior] as string)
  return parts.length ? parts.join('・') : '何もしない'
}

function QuestionNew({ host }: { host?: TemplateEditHost }) {
  const router = useRouter()
  const params = useSearchParams()
  /* 統括の入口（host）では店のテンプレートを読まない（新しく作るだけ）。 */
  const id = host ? null : params.get('id')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  usePageTitle(host ? 'テンプレート' : id ? '質問を編集' : '質問を作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'テンプレート', href: '/templates' }])
  /* 統括の編集（host.initialContent）：保存してある質問から始める。形が合わなければ空から。 */
  const [hostInitial] = useState(() => {
    const content = host?.initialContent
    return content?.kind === 'question' && isEditableQuestion(content.question as unknown as ScenarioQuestion) ? { name: content.name, question: content.question as unknown as ScenarioQuestion } : null
  })
  const [name, setName] = useState(hostInitial?.name ?? '')
  const [category, setCategory] = useState('未分類')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [templateAccountId, setTemplateAccountId] = useState<string | null>(null)
  const [initialQuestion] = useState<ScenarioQuestion>(() => hostInitial?.question ?? emptyQuestion())
  const [question, setQuestion] = useState<ScenarioQuestion>(initialQuestion)
  const [usageCount, setUsageCount] = useState(0)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [publishConfirm, setPublishConfirm] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [canMutate] = useState(() => (typeof window === 'undefined' ? true : isOwnerOrAdmin()))
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf({ name: hostInitial?.name ?? '', category: '未分類', folderId: null, question: initialQuestion }))

  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId || host) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [folderAccountId])

  /* 「押されたら」の名前（タグ・シナリオ）。読めなくても設定は消えない（名前の代わりに種類を出す）。 */
  useEffect(() => {
    if (!selectedAccountId || host) return
    let cancelled = false
    void Promise.allSettled([api.tags.list({ accountId: selectedAccountId }), api.scenarios.list({ accountId: selectedAccountId })]).then(([tagResult, scenarioResult]) => {
      if (cancelled) return
      if (tagResult.status === 'fulfilled' && tagResult.value.success) setTags(tagResult.value.data)
      if (scenarioResult.status === 'fulfilled' && scenarioResult.value.success) setScenarios(scenarioResult.value.data)
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
        if (!template.success || !template.data.question || !isEditableQuestion(template.data.question)) {
          setError('質問テンプレートを読み込めませんでした。')
          return
        }
        setName(template.data.name)
        setTemplateAccountId(template.data.accountId ?? null)
        setCategory(template.data.category || '未分類')
        setFolderId(template.data.folderId ?? null)
        setQuestion(template.data.question)
        setSavedSnapshot(snapshotOf({ name: template.data.name, category: template.data.category || '未分類', folderId: template.data.folderId ?? null, question: template.data.question }))
        setUsageCount(Object.values(template.data.usedBy).reduce((total, items) => total + items.length, 0))
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(isForbiddenOrRateLimited(caught) ? loadFailureNotice(caught, '質問テンプレート') : '質問テンプレートを読み込めませんでした。')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, selectedAccountId])

  const dirty = snapshotOf({ name, category, folderId, question }) !== savedSnapshot
  const { leaveTarget, confirmLeave, cancelLeave, guarded, disarm } = useUnsavedGuard({ dirty, busy: saving || publishing })

  const save = async (questionStatus: 'draft' | 'published'): Promise<boolean> => {
    if (host) {
      if (!name.trim()) { setError('テンプレート名を入力してください。'); return false }
      if (!question.text.trim()) { setError('質問文を入力してください。'); return false }
      if (question.choices.length === 0 || question.choices.some((choice) => !choice.label.trim())) { setError('すべての選択肢に文字を入力してください。'); return false }
      setError('')
      disarm()
      host.onSave({ kind: 'question', name: name.trim(), question: question as unknown as Record<string, unknown>, messageContent: question.intro?.trim() || question.text }, questionStatus === 'published')
      return false
    }
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください。'); return false }
    if (!name.trim()) { setError('テンプレート名を入力してください。'); return false }
    if (!question.text.trim()) { setError('質問文を入力してください。'); return false }
    if (question.choices.length === 0 || question.choices.some((choice) => !choice.label.trim())) { setError('すべての選択肢に文字を入力してください。'); return false }
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
      const result = id ? await api.templates.update(id, payload) : await api.templates.create(payload)
      if (!result.success) { setError(result.error || '保存できませんでした。'); return false }
      return true
    } catch (caught) {
      setError(describeApiFailure(caught, '保存', { forbidden: '質問テンプレートの作成・変更はオーナーと管理者だけができます。' }))
      return false
    } finally {
      setSaving(false)
    }
  }
  const leaveToList = () => { disarm(); router.push('/templates') }
  const onSaveDraft = async () => { if (await save('draft')) leaveToList() }
  /* 使われている質問を公開すると利用先へ新しい内容が届くので、使用先があれば確認の窓を挟む（cuR8I）。 */
  const onPublish = async () => {
    if (id && usageCount > 0) { setPublishConfirm(true); return }
    setPublishing(true)
    try { if (await save('published')) leaveToList() } finally { setPublishing(false) }
  }

  const setChoice = (index: number, patch: Partial<QuestionChoice>) =>
    setQuestion((current) => ({ ...current, choices: current.choices.map((choice, i) => i === index ? { ...choice, ...patch } : choice) }))
  const removeChoice = (index: number) =>
    setQuestion((current) => ({ ...current, choices: current.choices.filter((_, i) => i !== index) }))
  const addChoice = () =>
    setQuestion((current) => ({ ...current, choices: [...current.choices, { key: newChoiceKey(), label: '', behavior: 'none' }] }))
  const summaryOf = useMemo(() => (choice: QuestionChoice) => choiceActionText(choice, tags, scenarios), [tags, scenarios])

  if (loading || (accountLoading && !host)) return <ListState kind="loading" title="質問テンプレートを読み込んでいます" />

  if (host ? host.readOnly : !canMutate) {
    return (
      <TemplateEditFrame boardId="l87p1J" title="質問テンプレート" description="質問テンプレートの作成・変更はオーナーと管理者だけができます" side={null}>
        <p className={styles.note}>一覧で中身を確認できます。</p>
        <Link href="/templates" className={styles.back}>一覧へ戻る</Link>
      </TemplateEditFrame>
    )
  }

  const busy = saving || publishing || Boolean(host?.busy)
  const phone = (
    <LinePreview note="質問の見え方（山田 太郎さんの場合）" caption="配信日 10:00">
      <div className={styles.bubble}>
        {question.intro?.trim() ? <p className={styles.bubbleIntro}>{displayText(question.intro)}</p> : null}
        <p className={styles.bubbleText}>{displayText(question.text) || '質問文を入力すると、ここに出ます。'}</p>
        {question.choices.map((choice, index) => (
          <p key={choice.key ?? index} className={styles.bubbleChoice}>{choice.label || `選択肢${index + 1}`}</p>
        ))}
      </div>
    </LinePreview>
  )

  return (
    <>
      <TemplateEditFrame
        boardId="l87p1J"
        title={id ? '質問を編集' : '質問を作る'}
        description="ボタンで答えてもらい、答えでタグなどを付ける"
        side={(
          <>
            <section className={te.sideCard}>
              <h2 className={te.sideTitle}>この質問を使う場所</h2>
              <p className={te.sideText}>{id ? `使用先 ${usageCount}か所` : '保存すると、一斉配信・シナリオから選べます。'}</p>
            </section>
            <h2 className={te.previewHead}>届き方</h2>
            <div className={te.phone}>{phone}</div>
          </>
        )}
        footerActions={(
          <>
            <Button type="button" onClick={() => (host ? host.onCancel() : guarded(() => router.push('/templates')))} disabled={busy}>キャンセル</Button>
            <Button type="button" onClick={() => void onSaveDraft()} disabled={busy} busy={saving && !publishing}>下書きを保存</Button>
            <Button type="button" variant="primary" onClick={() => void onPublish()} disabled={busy} busy={publishing || Boolean(host?.busy)}><Send size={15} aria-hidden="true" />{host ? host.primaryLabel ?? '保存して配る' : '保存して公開'}</Button>
          </>
        )}
      >
        {host?.notice}
        {error ? <Notice tone="danger" message={error} /> : null}

        <section className={styles.card} aria-labelledby="q-name">
          <h2 className={styles.cardTitle} id="q-name">名前とフォルダ</h2>
          <div className={styles.row}>
            <label className={`${styles.field} ${styles.grow}`}>
              <span className={styles.label}>テンプレート名</span>
              <input className={styles.input} value={name} maxLength={120} placeholder="例：継続の意思をうかがう" onChange={(event) => setName(event.target.value)} />
            </label>
            <div className={`${styles.field} ${styles.folder}`}>
              <span className={styles.pickLabel}>フォルダ</span>
              <Select
                size="full"
                aria-label="フォルダ"
                value={host ? host.folder : folderId ?? ''}
                onChange={(value) => {
                  if (host) { host.onFolderChange(value); return }
                  const next = value || null
                  setFolderId(next)
                  setCategory(folders.find((folder) => folder.id === next)?.name ?? '未分類')
                }}
                options={[{ value: '', label: '未分類' }, ...(host ? host.folders : folders.map((folder) => ({ value: folder.id, label: folder.name })))]}
              />
            </div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="q-question">
          <h2 className={styles.cardTitle} id="q-question">質問</h2>
          <label className={styles.field}>
            <span className={styles.label}>前文（空なら送らない）<span className={styles.optional}>任意</span></span>
            <input className={styles.input} value={question.intro ?? ''} maxLength={4500} placeholder="いつもありがとうございます。" onChange={(event) => setQuestion((current) => ({ ...current, intro: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>質問文（160文字まで）</span>
            <input className={styles.input} value={question.text} maxLength={160} placeholder="来月も定期便を続けますか？" onChange={(event) => setQuestion((current) => ({ ...current, text: event.target.value }))} />
          </label>
          <div className={styles.inline}>
            <span className={styles.pickLabel} id="q-mode">答え方</span>
            <span className={styles.seg} role="radiogroup" aria-labelledby="q-mode">
              {([['single', '1つだけ選ぶ'], ['multiple', 'いくつでも選ぶ']] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={question.tapMode === value} className={styles.segButton} onClick={() => setQuestion((current) => ({ ...current, tapMode: value }))}>{label}</button>
              ))}
            </span>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="q-choices">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="q-choices">選択肢</h2>
            <p className={styles.note}>答えをどこに残すかを、選択肢ごとに決めます</p>
          </div>
          <div className={styles.choices}>
            {question.choices.map((choice, index) => (
              <div key={choice.key ?? index} className={styles.choice}>
                <div className={styles.choiceHead}>
                  <span className={styles.choiceNo}>{`選択肢 ${index + 1}`}</span>
                  <Button type="button" variant="text" disabled={question.choices.length <= 1} onClick={() => removeChoice(index)} aria-label={`選択肢 ${index + 1} を消す`}>消す</Button>
                </div>
                <label className={styles.field}>
                  <span className={styles.label}>ボタンの文字（20文字まで）</span>
                  <input className={styles.input} value={choice.label} maxLength={20} onChange={(event) => setChoice(index, { label: event.target.value })} />
                </label>
                {host ? null : <div className={styles.inline}>
                  <span className={styles.smallLabel}>押されたら</span>
                  <button type="button" className={styles.pick} title="押したときの動き（タグ・友だち情報・シナリオ・URL など）を決める" onClick={() => setActionsOpen(true)}>
                    <span className={styles.pickText}>{summaryOf(choice)}</span>
                    <ChevronDown className={styles.pickIcon} aria-hidden="true" />
                  </button>
                </div>}
                <label className={styles.field}>
                  <span className={styles.label}>押したときの返信<span className={styles.optional}>任意</span></span>
                  <input className={styles.input} value={choice.reply ?? ''} maxLength={4500} onChange={(event) => setChoice(index, { reply: event.target.value })} />
                </label>
              </div>
            ))}
          </div>
          <span>
            <Button type="button" variant="text" disabled={question.choices.length >= MAX_CHOICES} onClick={addChoice}>
              <Plus size={15} aria-hidden="true" />{`選択肢を足す（最大 ${MAX_CHOICES} つ）`}
            </Button>
          </span>
        </section>
      </TemplateEditFrame>

      {/* 押したときの動きは今の部品で決める（全部の選択肢をまとめて直せる）。 */}
      <Dialog open={actionsOpen} size="large" title="押したときの動き" onCancel={() => setActionsOpen(false)}>
        {actionsOpen ? <QuestionEditor value={question} onChange={setQuestion} choiceColumns /> : null}
      </Dialog>
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
            if (await save('published')) { setPublishConfirm(false); leaveToList() }
          } finally {
            setPublishing(false)
          }
        }}
        onCancel={() => setPublishConfirm(false)}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="質問への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

/** `host` を渡すと統括のテンプレートの入口から使う（template-edit/host.ts）。押したときの動き（店のタグ・シナリオ）は出さない。 */
export default function QuestionNewV8({ host }: { host?: TemplateEditHost } = {}) {
  return (
    <Suspense fallback={<ListState kind="loading" title="質問テンプレートを準備しています" />}>
      <QuestionNew host={host} />
    </Suspense>
  )
}
