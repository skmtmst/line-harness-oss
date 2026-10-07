'use client'

/*
 * ★V8-B 分析「ファネルを作る」（板 `VDPz5`）と「ファネルを直す」（同じ形）。
 *
 * 今の作る・直すフォーム（app/analytics/page.tsx の FunnelForm）の動きを写して一から書いた。
 * 絵は「段Nの名前 ｜ 何をしたら」の2列。何をしたらは、種類と相手（成果地点・タグ・フォーム）を
 * 1つの選ぶ欄にまとめる（例：成果「商品を買った」）。一覧に無い相手・IDで決める種類
 * （情報欄・サイトのページ・リンク・オートメーション）は「ほかの条件（IDで決める）」を選ぶと、
 * その段の下に種類とIDの欄が出る。保存の形（kind・match・版の追加）は今と同じ。
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import type { FunnelEditDraft } from './funnel'
import styles from './funnel-form.module.css'

/** 段の種類（今の画面と同じ並び・同じ言葉）。hint は ID の欄の名前。 */
export const FUNNEL_STEP_KINDS = [
  { key: 'friend_add', label: '友だち追加', hint: '' },
  { key: 'tag', label: 'タグが付いた', hint: 'タグのID' },
  { key: 'field', label: '情報欄に値が入った', hint: '項目のID（値は問いません）' },
  { key: 'form', label: 'フォームに答えた', hint: 'フォームのID' },
  { key: 'site_event', label: 'サイトのページを見た', hint: 'パスのまとまり（例: thanks）' },
  { key: 'purchase', label: '購入が確定した', hint: '' },
  { key: 'link_click', label: 'リンクを踏んだ', hint: '計測リンクのID' },
  { key: 'conversion', label: '成果が記録された', hint: '成果地点のID' },
  { key: 'message', label: 'メッセージを受信した', hint: '' },
  { key: 'booking', label: '予約が確定した', hint: '' },
  { key: 'automation', label: 'オートメーションが動いた', hint: 'オートメーションのID' },
] as const

const NO_VALUE_KINDS = ['friend_add', 'purchase', 'message', 'booking']
const OTHER = '__other__'
const MAX_STEPS = 10
const MIN_STEPS = 2

export function kindNeedsValue(kind: string): boolean {
  return !NO_VALUE_KINDS.includes(kind)
}

/** 段の条件（match）。今の画面の matchFor と同じ。 */
export function funnelMatchFor(kind: string, value: string): Record<string, string> {
  if (kind === 'friend_add') return {}
  if (kind === 'tag') return { tagId: value }
  if (kind === 'field') return { fieldId: value }
  if (kind === 'form') return { formId: value }
  if (kind === 'site_event') return { eventType: 'page_view', pathGroup: value }
  if (kind === 'purchase') return { status: 'confirmed' }
  if (kind === 'link_click') return { trackedLinkId: value }
  if (kind === 'conversion') return { conversionPointId: value }
  if (kind === 'message') return { direction: 'received' }
  if (kind === 'booking') return { status: 'confirmed' }
  return { automationId: value }
}

/** 直すとき、元の版の副条件に入れ直す主キー。今の画面と同じ。 */
export function funnelStepPrimaryKey(kind: string): string | null {
  switch (kind) {
    case 'tag': return 'tagId'
    case 'field': return 'fieldId'
    case 'form': return 'formId'
    case 'site_event': return 'pathGroup'
    case 'link_click': return 'trackedLinkId'
    case 'conversion': return 'conversionPointId'
    case 'automation': return 'automationId'
    default: return null
  }
}

function explainSaveError(code: string, fallback: string): string {
  if (code === 'analytics_funnel_version_conflict' || code === 'analytics_funnel_status_conflict') {
    return '他の人が先に変更しています。最新の状態を開き直してください'
  }
  if (code === 'analytics_funnel_invalid_transition') return 'その状態へは進めません'
  return fallback
}

type Target = { kind: 'conversion' | 'tag' | 'form'; id: string; name: string }
type Step = { label: string; kind: string; value: string; matchBase?: Record<string, string>; other: boolean }

/** 選ぶ欄の値。種類だけの段は kind、相手のある段は kind:id、それ以外は「ほかの条件」。 */
export function choiceOf(step: Pick<Step, 'kind' | 'value' | 'other'>, targets: Target[]): string {
  if (step.other) return OTHER
  if (!kindNeedsValue(step.kind)) return step.kind
  if (targets.some((t) => t.kind === step.kind && t.id === step.value)) return `${step.kind}:${step.value}`
  if (!step.value) return `${step.kind}:`
  return OTHER
}

const TARGET_LABEL: Record<Target['kind'], string> = { conversion: '成果', tag: 'タグ', form: 'フォーム' }
const EMPTY_LABEL: Record<Target['kind'], string> = { conversion: '成果（成果地点を選ぶ）', tag: 'タグ（タグを選ぶ）', form: 'フォーム（フォームを選ぶ）' }

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toISOString().slice(0, 10)
}

export default function FunnelFormV8({ accountId, onCancel, onCreated, edit, presetConversion }: {
  accountId: string
  onCancel: () => void
  onCreated: (id: string, usageWarnings?: string[]) => void
  edit?: FunnelEditDraft
  presetConversion?: { id: string; name: string } | null
}) {
  const [name, setName] = useState(edit?.name ?? '')
  // 裏は1〜365日を受け付ける。7・30・90以外の日数も、直すときに失わないよう選ぶ欄に足す。
  const [windowDays, setWindowDays] = useState(edit?.windowDays ?? '30')
  const [steps, setSteps] = useState<Step[]>(
    edit?.steps.map((s) => ({ label: s.label, kind: s.kind, value: s.value, matchBase: s.match, other: false })) ?? [
      { label: '', kind: 'friend_add', value: '', other: false },
      { label: presetConversion?.name ?? '', kind: 'conversion', value: presetConversion?.id ?? '', other: false },
    ],
  )
  const [targets, setTargets] = useState<Target[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 何をしたらの相手（成果地点・タグ・フォーム）。読めなかったものは並べないだけ（IDで決める道は残る）。
  useEffect(() => {
    let active = true
    void Promise.allSettled([
      api.conversions.definitions({ from: isoDay(-365), to: isoDay(0), lineAccountId: accountId, sort: 'name_asc', limit: 100 }),
      api.tags.list({ accountId }),
      api.forms.list(accountId),
    ]).then(([conversions, tags, forms]) => {
      if (!active) return
      const next: Target[] = []
      if (conversions.status === 'fulfilled' && conversions.value.success) {
        const items = (conversions.value.data as { items?: Array<{ id: string; name: string; status?: string }> }).items ?? []
        for (const item of items) if (item.status !== 'stopped') next.push({ kind: 'conversion', id: item.id, name: item.name })
      }
      if (tags.status === 'fulfilled' && tags.value.success) {
        for (const tag of tags.value.data as Array<{ id: string; name: string }>) next.push({ kind: 'tag', id: tag.id, name: tag.name })
      }
      if (forms.status === 'fulfilled' && forms.value.success) {
        for (const form of forms.value.data) if (form.isActive) next.push({ kind: 'form', id: form.id, name: form.name })
      }
      // 成果地点の一覧から来たときは、その地点が一覧に無くても選べるようにする。
      if (presetConversion?.id && !next.some((t) => t.kind === 'conversion' && t.id === presetConversion.id)) {
        next.unshift({ kind: 'conversion', id: presetConversion.id, name: presetConversion.name })
      }
      setTargets(next)
    })
    return () => { active = false }
  }, [accountId, presetConversion?.id, presetConversion?.name])

  const options = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [
      { value: 'friend_add', label: '友だち追加' },
    ]
    for (const t of targets.filter((x) => x.kind === 'conversion')) list.push({ value: `conversion:${t.id}`, label: `成果「${t.name}」` })
    list.push({ value: 'booking', label: '予約が確定した' }, { value: 'purchase', label: '購入が確定した' }, { value: 'message', label: 'メッセージを受信した' })
    for (const t of targets.filter((x) => x.kind === 'form')) list.push({ value: `form:${t.id}`, label: `フォーム「${t.name}」` })
    for (const t of targets.filter((x) => x.kind === 'tag')) list.push({ value: `tag:${t.id}`, label: `タグ「${t.name}」` })
    list.push({ value: OTHER, label: 'ほかの条件（IDで決める）' })
    return list
  }, [targets])

  const optionsFor = (step: Step) => {
    const choice = choiceOf(step, targets)
    // 相手がまだ決まっていない段（成果地点を選ぶ前など）は、その旨の選択肢を先頭に出す。
    if (choice.endsWith(':')) {
      const kind = choice.slice(0, -1) as Target['kind']
      return [{ value: choice, label: EMPTY_LABEL[kind] ?? `${TARGET_LABEL[kind] ?? kind}を選ぶ` }, ...options]
    }
    return options
  }

  const update = (index: number, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s, j) => (j === index ? { ...s, ...patch } : s)))
  }

  const choose = (index: number, value: string) => {
    if (value === OTHER) {
      // 種類はそのまま、IDの欄を開く。
      update(index, { other: true, matchBase: undefined })
      return
    }
    const [kind, id = ''] = value.split(':')
    // 種類を変えた段は旧条件の match を引き継がない（別種類のキーが残ると誤集計になる）。
    update(index, { kind, value: id, other: false, matchBase: undefined })
  }

  const save = async () => {
    if (!name.trim()) return setError('名前を入力してください')
    if (steps.some((s) => !s.label.trim())) return setError('すべての段に名前を付けてください')
    if (steps.some((s) => kindNeedsValue(s.kind) && !s.value.trim())) return setError('すべての段で、何をしたら進むかを選んでください（IDで決める段はIDを入れてください）')
    setSaving(true)
    setError('')
    try {
      const payloadSteps = steps.map((s) => {
        // フォームに出せない副条件は元の版から残す。種類を変えた段は matchBase を捨ててある。
        const match = s.matchBase ? { ...s.matchBase } : funnelMatchFor(s.kind, s.value.trim())
        if (s.matchBase) {
          const key = funnelStepPrimaryKey(s.kind)
          if (key) match[key] = s.value.trim()
        }
        return { label: s.label.trim(), kind: s.kind, match }
      })
      if (edit) {
        const res = await api.analytics.v6Funnels.createVersion(accountId, edit.funnelId, {
          name: name.trim(),
          windowDays: Number(windowDays),
          steps: payloadSteps,
          segment: edit.segment,
          comparisonGroups: edit.comparisonGroups,
          expectedVersionNumber: edit.expectedVersionNumber,
        })
        if (!res.success) return setError(explainSaveError(res.error, res.error))
        onCreated(edit.funnelId, res.data.usageWarnings)
      } else {
        const res = await api.analytics.v6Funnels.create(accountId, { name: name.trim(), windowDays: Number(windowDays), steps: payloadSteps })
        if (!res.success) return setError(res.error)
        onCreated(res.data.funnelId, res.data.usageWarnings)
      }
    } catch {
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title={edit ? 'ファネルを直す' : 'ファネルを作る'}
      designWidth={600}
      designTop={120}
      designNode={edit ? undefined : 'VDPz5'}
      busy={saving}
      error={error || undefined}
      onCancel={onCancel}
      footer={(
        <div className={styles.footer}>
          <Button onClick={onCancel} disabled={saving}>キャンセル</Button>
          <Button variant="primary" onClick={() => void save()} busy={saving} busyLabel="保存しています…">
            {edit ? null : <Plus size={15} aria-hidden="true" />}{edit ? '新版として保存する' : '作る'}
          </Button>
        </div>
      )}
    >
      <div className={styles.form}>
        {presetConversion && !edit ? (
          <Notice tone="info">
            成果地点「{presetConversion.name}」を2段目に入れています。このまま段を組んで作成すると、その成果地点を使う分析として登録されます。
          </Notice>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="fn-v8-name" className={styles.label}>名前</label>
          <input id="fn-v8-name" type="text" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：広告から購入まで" />
        </div>
        <div className={styles.field}>
          <span className={styles.subLabel} id="fn-v8-window-label">何日以内の通過で数えるか</span>
          <Select
            id="fn-v8-window"
            aria-label="何日以内の通過で数えるか"
            size="full"
            value={windowDays}
            onChange={setWindowDays}
            options={[
              ...(['7', '30', '90'].includes(windowDays) ? [] : [{ value: windowDays, label: `${windowDays}日以内` }]),
              { value: '7', label: '7日以内' },
              { value: '30', label: '30日以内' },
              { value: '90', label: '90日以内' },
            ]}
          />
        </div>
        <div className={styles.steps} role="group" aria-label="段（上から順に見ます）">
          {steps.map((step, i) => {
            const kindHint = FUNNEL_STEP_KINDS.find((k) => k.key === step.kind)?.hint ?? ''
            return (
              <div key={i} className={styles.stepBlock}>
                <div className={styles.stepRow}>
                  <div className={styles.stepCol}>
                    <div className={styles.labelRow}>
                      <label htmlFor={`fn-v8-step-${i}`} className={styles.label}>{`段${i + 1}の名前`}</label>
                      {steps.length > MIN_STEPS ? (
                        <button type="button" className={styles.removeStep} onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))} aria-label={`段${i + 1}を外す`}>
                          <X size={12} aria-hidden="true" />外す
                        </button>
                      ) : null}
                    </div>
                    <input id={`fn-v8-step-${i}`} type="text" className={styles.input} value={step.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="例：友だち追加" />
                  </div>
                  <div className={styles.stepCol}>
                    <span className={styles.subLabel}>何をしたら</span>
                    <Select
                      aria-label={`${i + 1}段目で何をしたら進むか`}
                      size="full"
                      value={choiceOf(step, targets)}
                      onChange={(value) => choose(i, value)}
                      options={optionsFor(step)}
                    />
                  </div>
                </div>
                {step.other ? (
                  <div className={styles.stepRow}>
                    <div className={styles.stepCol}>
                      <span className={styles.subLabel}>種類</span>
                      <Select
                        aria-label={`${i + 1}段目の種類`}
                        size="full"
                        value={step.kind}
                        onChange={(value) => update(i, { kind: value, matchBase: undefined })}
                        options={FUNNEL_STEP_KINDS.map((k) => ({ value: k.key, label: k.label }))}
                      />
                    </div>
                    <div className={styles.stepCol}>
                      <label htmlFor={`fn-v8-value-${i}`} className={styles.subLabel}>{kindHint || '追加の指定はありません'}</label>
                      <input id={`fn-v8-value-${i}`} type="text" className={styles.input} value={step.value} disabled={!kindNeedsValue(step.kind)} onChange={(e) => update(i, { value: e.target.value })} />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className={styles.addRow}>
          {steps.length < MAX_STEPS ? (
            <Button onClick={() => setSteps((prev) => [...prev, { label: '', kind: 'friend_add', value: '', other: false }])}>＋ 段を足す</Button>
          ) : null}
          <span className={styles.addNote}>段は2つ以上10個まで。上から順に、次へ進んだ人を数えます。</span>
        </div>
      </div>
    </Dialog>
  )
}
