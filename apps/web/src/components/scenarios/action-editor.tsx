'use client'

/*
 * シナリオのアクションを編集する窓（設計 `V6 5 hz9ti 送信後のアクションを設定`）。
 *
 * 段の並びは設計に合わせて **「追加する動作を選ぶ」が先、「実行する動作」が後**。
 * 先に一覧を出して最後に追加口を置くと、まだ1つも無いときに何をすれば
 * いいのかが画面の一番下にしか無く、空の枠だけを見て手が止まる。
 *
 * 動作を番号つきのカードで積む形は変えていない。カードごとに条件・
 * 並べ替え・削除を置く。種別ごとに窓を分けると、「タグを付けてから、
 * そのタグを条件に次を動かす」が書けなくなる。
 *
 * 保存はカード単位で即時に行う。まとめて保存にすると、途中で閉じたときに
 * どこまで残ったかが分からない。
 *
 * 設計にあって、ここに置いていないもの:
 *
 *   - 共通設定の「アクション名」「フォルダ」… `scenario_actions` に名前も
 *     フォルダも無く、読む口も書く口も無い。空欄だけ置くと、書いたものが
 *     消えたように見える。引き継ぎは `docs/design-qa/v6-scenario-action-editor-handoff.md`
 *   - 8つの動作 … 実装が持つ種別は `ScenarioActionType` の5つ。押しても
 *     作れない札を3つ増やしても、できることは増えない
 *   - 「発動2回目以降も各動作を実行」をセクションに1つ … `repeatOnRefire` は
 *     動作1件ごとの列。1つにまとめると、動作ごとに違う値を持てなくなり、
 *     既にある設定を黙って上書きすることになる
 */

import { useCallback, useEffect, useState } from 'react'
import { Flag, Tag, User, Variable, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import styles from './action-editor.module.css'
import { api, type ScenarioAction, type ScenarioActionHook, type ScenarioActionType } from '@/lib/api'
import ConditionBuilder, {
  pruneCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'
import { useAccount } from '@/contexts/account-context'

export const ACTION_KINDS: {
  type: ScenarioActionType
  label: string
  /** 札の上に出す目印（設計 18px）。文字だけだと5つが同じ形に見える。 */
  icon: LucideIcon
  make: () => unknown
}[] = [
  { type: 'tag', label: 'タグ操作', icon: Tag, make: () => ({ op: 'add', tagIds: [] }) },
  {
    type: 'friend_field',
    label: '友だち情報操作',
    icon: User,
    make: () => ({ fieldId: '', op: 'set', value: '' }),
  },
  { type: 'support_mark', label: '対応マーク操作', icon: Flag, make: () => ({ markId: null }) },
  {
    type: 'scenario',
    label: 'シナリオ操作',
    icon: Workflow,
    make: () => ({ op: 'start', scenarioId: '', restart: 'from_start' }),
  },
  {
    type: 'common_var',
    label: '共通情報操作',
    icon: Variable,
    make: () => ({ varKey: '', op: 'add', value: '1' }),
  },
]

const KIND_LABEL: Record<ScenarioActionType, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報操作',
  support_mark: '対応マーク操作',
  scenario: 'シナリオ操作',
  common_var: '共通情報操作',
}

interface Option {
  id: string
  name: string
}

export interface ActionEditorProps {
  scenarioId: string
  hook: ScenarioActionHook
  stepId?: string | null
  choiceIndex?: number | null
  /** 見出しに出す説明。「この通を送ったあと」など。 */
  title: string
  onClose: () => void
  /** 保存のたびに呼ぶ。件数バッジの更新に使う。 */
  onChanged?: () => void
}

export default function ActionEditor({
  scenarioId,
  hook,
  stepId = null,
  choiceIndex = null,
  title,
  onClose,
  onChanged,
}: ActionEditorProps) {
  const { selectedAccountId } = useAccount()
  const [actions, setActions] = useState<ScenarioAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conditionFor, setConditionFor] = useState<string | null>(null)

  const [tags, setTags] = useState<Option[]>([])
  const [fields, setFields] = useState<Option[]>([])
  const [marks, setMarks] = useState<Option[]>([])
  const [scenarioOpts, setScenarioOpts] = useState<Option[]>([])
  const [vars, setVars] = useState<{ varKey: string; name: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.scenarios.actions.list(scenarioId)
    if (res.success) {
      setActions(
        res.data.filter(
          (a) =>
            a.hook === hook &&
            (a.stepId ?? null) === (stepId ?? null) &&
            (a.choiceIndex ?? null) === (choiceIndex ?? null),
        ),
      )
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [scenarioId, hook, stepId, choiceIndex])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedAccountId) {
      setMarks([])
      return
    }
    void (async () => {
      const [tagRes, fieldRes, markRes, scenarioRes, varRes] = await Promise.all([
        api.tags.list(),
        api.friendFields.list(selectedAccountId),
        api.supportMarks.list(selectedAccountId),
        api.scenarios.list(),
        api.commonVars.list(selectedAccountId),
      ])
      if (tagRes.success) setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      if (fieldRes.success) setFields(fieldRes.data.map((f) => ({ id: f.id, name: f.name })))
      if (markRes.success) setMarks(markRes.data.map((m) => ({ id: m.id, name: m.name })))
      if (scenarioRes.success)
        setScenarioOpts(
          scenarioRes.data.filter((s) => s.id !== scenarioId).map((s) => ({ id: s.id, name: s.name })),
        )
      if (varRes.success) setVars(varRes.data.map((v) => ({ varKey: v.varKey, name: v.name })))
    })()
  }, [scenarioId, selectedAccountId])

  const add = async (kind: (typeof ACTION_KINDS)[number]) => {
    setError('')
    const res = await api.scenarios.actions.create(scenarioId, {
      hook,
      stepId,
      choiceIndex,
      actionType: kind.type,
      config: kind.make(),
      repeatOnRefire: true,
    })
    if (!res.success) {
      setError(res.error)
      return
    }
    await load()
    onChanged?.()
  }

  const save = async (action: ScenarioAction, patch: Partial<ScenarioAction>) => {
    setError('')
    const res = await api.scenarios.actions.update(scenarioId, action.id, {
      config: patch.config ?? action.config,
      condition: patch.condition !== undefined ? patch.condition : action.condition,
      repeatOnRefire: patch.repeatOnRefire ?? action.repeatOnRefire,
      sortOrder: patch.sortOrder ?? action.sortOrder,
    })
    if (!res.success) {
      setError(res.error)
      return
    }
    await load()
    onChanged?.()
  }

  const remove = async (action: ScenarioAction) => {
    setError('')
    const res = await api.scenarios.actions.remove(scenarioId, action.id)
    if (!res.success) {
      setError(res.error)
      return
    }
    await load()
    onChanged?.()
  }

  /** 上下の入れ替え。並び順は実行順なので、見た目と実行が一致している必要がある。 */
  const move = async (index: number, direction: -1 | 1) => {
    const target = actions[index + direction]
    if (!target) return
    const current = actions[index]
    await api.scenarios.actions.update(scenarioId, current.id, { sortOrder: target.sortOrder })
    await api.scenarios.actions.update(scenarioId, target.id, { sortOrder: current.sortOrder })
    await load()
    onChanged?.()
  }

  const editing = actions.find((a) => a.id === conditionFor) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div data-design-node="hz9ti" className={`${styles.dialog} rounded-card w-full bg-white shadow-lg`}>
        {/* ① 見出しと説明。設計は見出し20/700・説明13。 */}
        <div className="border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-ink text-title font-bold">送信後のアクションを設定</h2>
            <p className="text-ink-secondary mt-1 text-label leading-relaxed">
              {title}に実行する動作を決めます。上から順に実行します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 shrink-0 border px-4 text-sm"
          >
            閉じる
          </button>
        </div>

        {editing ? (
          <div className="px-6 py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-bold">
                {actions.indexOf(editing) + 1}. [{KIND_LABEL[editing.actionType]}] の条件設定
              </p>
              <button
                type="button"
                onClick={() => setConditionFor(null)}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 border px-4 text-sm"
              >
                戻る
              </button>
            </div>
            <p className="text-ink-secondary mb-4 text-xs">
              ここで決めた条件に合う友だちにだけ、この動作を実行します。条件なしなら全員に実行します。
            </p>
            <ConditionBuilder
              value={(editing.condition as SegmentCondition | null) ?? null}
              onChange={(next) => void save(editing, { condition: pruneCondition(next) })}
            />
          </div>
        ) : (
          <div className="px-6 py-5">
            {error && (
              <p className="rounded-card bg-danger-bg text-danger mb-4 px-4 py-3 text-sm">{error}</p>
            )}
            {loading ? (
              <p className="text-ink-faint py-8 text-center text-sm">読み込んでいます</p>
            ) : (
              <div className="space-y-6">
                {/*
                  ③ 追加する動作を選ぶ。設計は一覧より前。
                  1つも無いときに「次に何をするか」が画面の一番下にあると、
                  空の枠だけを見て手が止まる。
                */}
                <section>
                  <h3 className="text-ink text-sm font-bold">追加する動作を選ぶ</h3>
                  <p className="text-ink-secondary mt-0.5 text-label leading-relaxed">
                    選ぶと、下の「実行する動作」の最後に足します。中身はあとから決められます。
                  </p>
                  {/* 設計は4×2。実装が持つ種別は5つなので、押せない札は並べない。 */}
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ACTION_KINDS.map((kind) => {
                      const Icon = kind.icon
                      return (
                        <button
                          key={kind.type}
                          type="button"
                          onClick={() => void add(kind)}
                          className={`${styles.kindButton} border-hairline text-ink hover:bg-canvas-sunken flex flex-col items-center justify-center gap-1 border text-caption font-bold transition-colors`}
                        >
                          <Icon aria-hidden size={18} strokeWidth={1.75} />
                          {kind.label}
                        </button>
                      )
                    })}
                  </div>
                </section>

                {/* ④ 実行する動作。並び順がそのまま実行順。 */}
                <section>
                  <h3 className="text-ink text-sm font-bold">実行する動作（上から順に実行）</h3>
                  <p className="text-ink-secondary mt-0.5 text-label leading-relaxed">
                    「発動2回目以降も実行する」は動作ごとに決めます。同じ友だちが2回目に通ったとき、
                    タグは付け直しても、加算はもう一度足したくない、といった使い分けができます。
                  </p>
                  <div className="mt-3 space-y-3">
                    {actions.map((action, index) => (
                      <div key={action.id} className="border-hairline rounded-card border">
                        <div className={`${styles.actionRow} border-hairline bg-canvas-sunken flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5`}>
                          <p className="text-ink flex flex-wrap items-center gap-2 text-sm font-bold">
                            {/* 実行順の丸番号（設計 26x26）。並べ替えるとここが変わる。 */}
                            <span className={`${styles.orderMark} bg-accent-deep text-on-accent flex shrink-0 items-center justify-center rounded-pill text-caption font-bold`}>
                              {index + 1}
                            </span>
                            <span>{KIND_LABEL[action.actionType]}</span>
                            {/* 埋まっていないアクションは配信で実行されない。
                                黙って何もしないと、効いていないことに気づけない。 */}
                            {action.complete === false && (
                              <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-[10px] font-medium">
                                未完成 — 配信では実行されません
                              </span>
                            )}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConditionFor(action.id)}
                              className={`rounded-control h-9 border px-3 text-xs ${
                                action.condition
                                  ? 'border-accent text-accent bg-accent-soft'
                                  : 'border-hairline text-ink-secondary'
                              }`}
                            >
                              {action.condition ? '条件ON' : '条件OFF'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void move(index, -1)}
                              disabled={index === 0}
                              aria-label="1つ上へ"
                              className="border-hairline text-ink-secondary rounded-control h-9 border px-3 text-xs disabled:opacity-40"
                            >
                              上へ
                            </button>
                            <button
                              type="button"
                              onClick={() => void move(index, 1)}
                              disabled={index === actions.length - 1}
                              aria-label="1つ下へ"
                              className="border-hairline text-ink-secondary rounded-control h-9 border px-3 text-xs disabled:opacity-40"
                            >
                              下へ
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove(action)}
                              className="border-hairline text-danger rounded-control h-9 border px-3 text-xs"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                        <div className="space-y-3 px-4 py-3">
                          <ActionConfigEditor
                            action={action}
                            tags={tags}
                            fields={fields}
                            marks={marks}
                            scenarios={scenarioOpts}
                            vars={vars}
                            onChange={(config) => void save(action, { config })}
                          />
                          <label className="text-ink-secondary flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={action.repeatOnRefire}
                              onChange={(e) => void save(action, { repeatOnRefire: e.target.checked })}
                            />
                            発動2回目以降も実行する
                          </label>
                        </div>
                      </div>
                    ))}
                    {actions.length === 0 && (
                      <p className="text-ink-faint rounded-card border-hairline border border-dashed py-8 text-center text-sm">
                        まだ動作がありません。上の「追加する動作を選ぶ」から足してください。
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const selectClass = 'border-hairline rounded-control text-ink h-9 border bg-white px-2 text-sm min-w-0'
const inputClass = 'border-hairline rounded-control text-ink h-9 border px-3 text-sm min-w-0 flex-1'

/**
 * アクション1つぶんの中身を編集する。
 *
 * 値と onChange だけで動く。シナリオ（scenario_actions の行）からも、
 * 自動応答（actions_json）からも同じものを使う。**中身の編集を2つ持つと、
 * 種別を足したときに片方だけ増える。**
 */
export function ActionConfigEditor({
  action,
  tags,
  fields,
  marks,
  scenarios,
  vars,
  onChange,
}: {
  action: ScenarioAction
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
  vars: { varKey: string; name: string }[]
  onChange: (config: unknown) => void
}) {
  const c = (action.config ?? {}) as Record<string, unknown>

  switch (action.actionType) {
    case 'tag': {
      const selected = Array.isArray(c.tagIds) ? (c.tagIds as string[]) : []
      return (
        <>
          <div className="flex flex-wrap items-center gap-4">
            {(['add', 'remove'] as const).map((op) => (
              <label key={op} className="text-ink flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={(c.op ?? 'add') === op}
                  onChange={() => onChange({ ...c, op })}
                />
                {op === 'add' ? 'タグを追加' : 'タグをはずす'}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const on = selected.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...c,
                      tagIds: on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id],
                    })
                  }
                  className={`rounded-pill h-8 px-3 text-xs transition-colors ${
                    on ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border'
                  }`}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
        </>
      )
    }

    case 'friend_field':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={String(c.fieldId ?? '')}
            onChange={(e) => onChange({ ...c, fieldId: e.target.value })}
            className={selectClass}
          >
            <option value="">項目を選ぶ</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="text-ink-secondary text-sm">に</span>
          {c.op !== 'clear' && (
            <input
              value={String(c.value ?? '')}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
              className={inputClass}
            />
          )}
          <span className="text-ink-secondary text-sm">を</span>
          <select
            value={String(c.op ?? 'set')}
            onChange={(e) => onChange({ ...c, op: e.target.value })}
            className={selectClass}
          >
            <option value="set">← (代入)</option>
            <option value="add">＋ (加算)</option>
            <option value="sub">－ (減算)</option>
            <option value="clear">X (消去)</option>
          </select>
          <span className="text-ink-secondary text-sm">する</span>
        </div>
      )

    case 'support_mark':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">対応マーク</span>
          <select
            value={String(c.markId ?? '')}
            onChange={(e) => onChange({ ...c, markId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">マークを外す</option>
            {marks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )

    case 'scenario':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={String(c.op ?? 'start')}
              onChange={(e) => onChange({ ...c, op: e.target.value })}
              className={selectClass}
            >
              <option value="start">購読を始める</option>
              <option value="stop">購読を止める</option>
              <option value="resume_previous">1つ前のシナリオを再開する</option>
            </select>
            {c.op !== 'resume_previous' && (
              <select
                value={String(c.scenarioId ?? '')}
                onChange={(e) => onChange({ ...c, scenarioId: e.target.value })}
                className={selectClass}
              >
                <option value="">{c.op === 'stop' ? 'このシナリオ' : 'シナリオを選ぶ'}</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {c.op === 'start' && (
            <div className="bg-canvas-sunken rounded-card space-y-2 px-3 py-2.5">
              <p className="text-ink text-xs font-bold">シナリオを購読する場合</p>
              {(
                [
                  { value: 'from_start', label: '(新規)最初から／(再開)最初から' },
                  { value: 'from_read', label: '(再開)友だちが読んだところから' },
                ] as const
              ).map((opt) => (
                <label key={opt.value} className="text-ink-secondary flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={(c.restart ?? 'from_start') === opt.value}
                    onChange={() => onChange({ ...c, restart: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
              <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={c.rememberPrevious === true}
                  onChange={(e) => onChange({ ...c, rememberPrevious: e.target.checked })}
                />
                いま読んでいるシナリオを控えて、あとで「1つ前のシナリオを再開」で戻せるようにする
              </label>
            </div>
          )}
        </div>
      )

    case 'common_var':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={String(c.varKey ?? '')}
            onChange={(e) => onChange({ ...c, varKey: e.target.value })}
            className={selectClass}
          >
            <option value="">共通情報を選ぶ</option>
            {vars.map((v) => (
              <option key={v.varKey} value={v.varKey}>
                {v.name}
              </option>
            ))}
          </select>
          <span className="text-ink-secondary text-sm">に</span>
          <input
            value={String(c.value ?? '')}
            onChange={(e) => onChange({ ...c, value: e.target.value })}
            className={inputClass}
          />
          <span className="text-ink-secondary text-sm">を</span>
          <select
            value={String(c.op ?? 'add')}
            onChange={(e) => onChange({ ...c, op: e.target.value })}
            className={selectClass}
          >
            <option value="add">＋ (加算)</option>
            <option value="sub">－ (減算)</option>
          </select>
          <span className="text-ink-secondary text-sm">する</span>
        </div>
      )

    default:
      return null
  }
}
