'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { FriendAddRouting, FriendAddAction } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'

type Option = { id: string; name: string }

export default function FriendAddSettingsPage() {
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  // AccountProvider は、未選択のとき先頭店舗へ勝手に寄せない契約。
  // 保存画面だけ先頭へ寄せると、選んでいない店舗の設定を書き換えてしまう。
  const accountId = selectedAccountId
  const activeAccountRef = useRef<string | null>(accountId)

  const [routing, setRouting] = useState<FriendAddRouting | null>(null)
  const [configured, setConfigured] = useState(false)
  const [scenarios, setScenarios] = useState<Option[]>([])
  const [tags, setTags] = useState<Option[]>([])
  /* アクションで選ぶもの。シナリオ側と同じ種類を出すために引く。 */
  const [marks, setMarks] = useState<Option[]>([])
  const [fields, setFields] = useState<Option[]>([])
  const [orphans, setOrphans] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [breakdown, setBreakdown] = useState<{
    days: number
    firstTime: number
    returning: number
    unblocked: number
  } | null>(null)
  const [breakdownError, setBreakdownError] = useState(false)
  const [optionsError, setOptionsError] = useState(false)

  useEffect(() => {
    activeAccountRef.current = accountId
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    setMarks([])
    setFields([])
    setOptionsError(false)
    if (!accountId) return () => { cancelled = true }
    void Promise.all([api.supportMarks.list(accountId), api.friendFields.list(accountId)]).then(([m, f]) => {
      if (cancelled) return
      if (m.success) setMarks(m.data.map(x => ({ id: x.id, name: x.name })))
      if (f.success) setFields(f.data.map(x => ({ id: x.id, name: x.name })))
      setOptionsError(!m.success || !f.success)
    }).catch(() => {
      if (!cancelled) setOptionsError(true)
    })
    return () => {
      cancelled = true
    }
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    setBreakdown(null)
    setBreakdownError(false)
    if (!accountId) return () => { cancelled = true }

    void api.friends.addBreakdown({ days: 30, accountId }).then(res => {
      if (!cancelled && res.success) setBreakdown(res.data)
    }).catch(() => {
      if (!cancelled) setBreakdownError(true)
    })
    return () => {
      cancelled = true
    }
  }, [accountId])

  const load = useCallback(async () => {
    if (!accountId) {
      setRouting(null)
      setConfigured(false)
      setScenarios([])
      setTags([])
      setLoadedAccountId(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setRouting(null)
    setLoadedAccountId(null)
    setSaving(false)
    setError('')
    setNotice('')
    try {
      const res = await api.friendAddRouting.get(accountId)
      if (activeAccountRef.current !== accountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRouting(res.data.routing)
      setConfigured(res.data.configured)
      setScenarios(res.data.scenarios)
      setTags(res.data.tags)
      setLoadedAccountId(accountId)
    } catch {
      if (activeAccountRef.current === accountId) {
        setError('設定を読み込めませんでした。通信を確認して、もう一度お試しください。')
      }
    } finally {
      if (activeAccountRef.current === accountId) setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  // 所属していた LINE アカウントが消えたシナリオ。設計の絵には無いが、
  // これが残っていると「有効なのに一生配信されない」ので落とさずに出す。
  useEffect(() => {
    let cancelled = false
    void api.scenarios.list().then(res => {
      if (cancelled || !res.success) return
      const known = new Set(accounts.map(a => a.id))
      setOrphans(
        res.data
          .filter(s => s.triggerType === 'friend_add' && s.lineAccountId !== null && !known.has(s.lineAccountId))
          .map(s => ({ id: s.id, name: s.name })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [accounts])

  const patch = (next: Partial<FriendAddRouting>) =>
    setRouting(prev => (prev ? { ...prev, ...next } : prev))

  /**
   * 保存してよいか。だめなら理由を返す。
   *
   * 「別のシナリオを配信する」を選んでシナリオが空のまま保存すると、
   * **有効な友だち追加シナリオが全部流れる**。この画面は「以前からの
   * お客さまに『はじめまして』を届けない」ためにあるのに、書きかけの
   * 設定がいちばん困る結果になる。
   */
  const routingError = (): string => {
    if (!routing) return ''
    if (routing.returning.mode === 'other' && !routing.returning.scenarioId) {
      return '「別のシナリオを配信する」を選んだときは、配信するシナリオを選んでください。選ばないまま保存すると、以前からの友だちにも有効なシナリオが全部届きます。'
    }
    return ''
  }

  const save = async () => {
    if (!accountId || !routing || loadedAccountId !== accountId) {
      setError('選択中のLINEアカウントの設定を読み込んでから保存してください。')
      setNotice('')
      return
    }
    const problem = routingError()
    if (problem) {
      setError(problem)
      setNotice('')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.friendAddRouting.save(accountId, routing)
      if (activeAccountRef.current !== accountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setConfigured(true)
      setNotice('保存しました。次に友だち追加された人からこの振り分けになります。')
    } catch {
      if (activeAccountRef.current === accountId) {
        setError('保存できませんでした。通信を確認して、もう一度お試しください。')
      }
    } finally {
      if (activeAccountRef.current === accountId) setSaving(false)
    }
  }

  const scenarioName = (id: string | null) =>
    (id && scenarios.find(s => s.id === id)?.name) || null

  if (accountLoading || loading) {
    return <div className="text-ink-faint py-12 text-center text-sm">読み込み中…</div>
  }

  if (!accountId) {
    return (
      <div className="text-ink-faint py-12 text-center text-sm">
        {accounts.length > 0
          ? '上のバーでLINE公式アカウントを選んでください'
          : 'LINE公式アカウントが登録されていません'}
      </div>
    )
  }

  if (!routing) {
    return (
      <div className="py-12 text-center text-sm">
        <p className="text-danger">{error || '設定を表示できませんでした'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-accent mt-3 font-semibold underline"
        >
          もう一度読み込む
        </button>
      </div>
    )
  }

  return (
    <div>
      <div data-design="Head" className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {/*
          実行結果への行き来（設計 9-1-H `P2J0Te`）。**設定だけ見ても、
          実際に動いたのかは分からない。** 設定と結果を往復できるようにする。
        */}
        <Button href="/friend-add-settings/runs">実行結果を見る</Button>
        <TestRunButton accountId={accountId} scenarioName={scenarioName} />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title={routingError() || undefined}
          className="bg-accent-deep hover:brightness-92 text-on-accent rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div data-design="Alert" className="space-y-2">
        {!configured && (
          <p className="bg-warning-bg text-warning rounded-card px-4 py-3 text-sm leading-relaxed">
            この2つを分けないと、以前からのお客さまに「はじめまして」の挨拶が届きます。ブロックを解除しただけの人にも同じことが起きます。
            <span className="text-ink-secondary">
              {' '}
              いまはまだ決めていないので、有効な友だち追加シナリオが相手によらず全部流れています。
            </span>
          </p>
        )}
        {error && (
          <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>
        )}
        {notice && (
          <p className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">{notice}</p>
        )}
        {optionsError && (
          <p className="bg-warning-bg text-warning rounded-card px-4 py-3 text-sm">
            アクションで選ぶ項目の一部を読み込めませんでした。再読み込みしてから設定してください。
          </p>
        )}
        {orphans.length > 0 && (
          <div className="bg-warning-bg rounded-card px-4 py-3 text-sm">
            <p className="text-warning font-semibold">
              所属していた LINE アカウントが消えたシナリオが {orphans.length} 件あります
            </p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              有効になっていても配信されません。残す理由が無ければ削除してください。
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {orphans.map(o => (
                <li key={o.id}>
                  <Link href={`/scenarios/detail?id=${o.id}`} className="text-accent text-xs underline">
                    {o.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {/* ① はじめて友だち追加した人 */}
          <section data-design="FirstTime" className="bg-canvas rounded-card border-hairline border p-5">
            <SectionTitle
              number={1}
              tone="accent"
              title="はじめて友だち追加した人"
              description="このアカウントを一度も友だち追加したことがない人が対象です。"
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="配信するシナリオ">
                <Select
                  value={routing.firstTime.scenarioId ?? ''}
                  onChange={v =>
                    patch({ firstTime: { ...routing.firstTime, scenarioId: v || null } })
                  }
                  options={scenarios}
                  placeholder="決めていない（有効なシナリオを全部流す）"
                  ariaLabel="初回の友だちへ配信するシナリオ"
                />
              </Field>
              <Field label="開始のタイミング">
                <Select
                  value={routing.firstTime.timing}
                  onChange={v =>
                    patch({
                      firstTime: { ...routing.firstTime, timing: v as FriendAddRouting['firstTime']['timing'] },
                    })
                  }
                  options={[
                    { id: 'immediate', name: 'すぐに配信' },
                    { id: 'scenario', name: 'シナリオの設定どおり' },
                  ]}
                  ariaLabel="初回シナリオを開始するタイミング"
                />
              </Field>
            </div>
            <ActionChips
              actions={routing.firstTime.actions}
              tags={tags}
              marks={marks}
              fields={fields}
              scenarios={scenarios}
              onChange={actions => patch({ firstTime: { ...routing.firstTime, actions } })}
            />
          </section>

          {/* ② 以前からの友だち・ブロックを解除した人 */}
          <section
            data-design="Returning"
            className="bg-canvas rounded-card border-warning/40 border-2 p-5"
          >
            <SectionTitle
              number={2}
              tone="warning"
              title="以前からの友だち・ブロックを解除した人"
              description="システム導入より前から友だちだった人と、一度ブロックしてから解除した人が対象です。"
            />
            <div className="mt-4 space-y-2">
              <RadioRow
                selected={routing.returning.mode === 'none'}
                onSelect={() => patch({ returning: { ...routing.returning, mode: 'none' } })}
                title="配信しない"
                description="何も送りません。既存のお客さまを驚かせたくない場合はこれが安全です。"
              />
              <RadioRow
                selected={routing.returning.mode === 'other'}
                onSelect={() => patch({ returning: { ...routing.returning, mode: 'other' } })}
                title="別のシナリオを配信する"
                description="「はじめまして」ではない、再開のご案内などを送れます。"
              />
              <RadioRow
                selected={routing.returning.mode === 'same'}
                onSelect={() => patch({ returning: { ...routing.returning, mode: 'same' } })}
                title="はじめての人と同じものを配信する"
                description="以前からのお客さまにも「はじめまして」が届きます。"
              />
            </div>

            {/*
              開始位置は「別のシナリオ」だけでなく「同じもの」でも要る。
              ブロック中は購読が止まったまま残るので、「最初から」だと
              その人には何も届かない（止まった購読が邪魔をする）。
            */}
            {routing.returning.mode !== 'none' && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {routing.returning.mode === 'other' && (
                <Field label="配信するシナリオ">
                  <Select
                    value={routing.returning.scenarioId ?? ''}
                    onChange={v =>
                      patch({ returning: { ...routing.returning, scenarioId: v || null } })
                    }
                    options={scenarios}
                    placeholder="選んでください"
                    ariaLabel="以前からの友だちへ配信するシナリオ"
                  />
                </Field>
                )}
                <Field label="開始位置">
                  <Select
                    value={routing.returning.startPosition}
                    onChange={v =>
                      patch({
                        returning: {
                          ...routing.returning,
                          startPosition: v as FriendAddRouting['returning']['startPosition'],
                        },
                      })
                    }
                    options={[
                      { id: 'resume', name: '前回読んだところから' },
                      { id: 'beginning', name: '最初から' },
                    ]}
                    ariaLabel="以前からの友だちへの配信開始位置"
                  />
                </Field>
              </div>
            )}

            {routing.returning.mode !== 'none' && (
              <p className="text-ink-faint mt-3 text-xs leading-relaxed">
                {routing.returning.startPosition === 'resume'
                  ? '前回読んだところから再開します。1通目は送り直しません。読み終えている人には最初から流れます。ブロックを解除した人は、ここが「最初から」だと止まった購読が残っていて何も届きません。'
                  : '1通目から届きます。ブロックを解除した人で、その配信が途中で止まっていた場合は、止まったまま何も届きません。「前回読んだところから」を選んでください。'}
              </p>
            )}

            <ActionChips
              actions={routing.returning.actions}
              tags={tags}
              marks={marks}
              fields={fields}
              scenarios={scenarios}
              onChange={actions => patch({ returning: { ...routing.returning, actions } })}
            />
          </section>

          {/* ③ 判定の基準 */}
          <section data-design="Rule" className="bg-canvas rounded-card border-hairline border p-5">
            <SectionTitle
              number={3}
              tone="accent"
              title="判定の基準"
              description="どちらに振り分けるかの判定方法です。通常は変更しません。"
            />
            {/*
              重なりの心配をここで打ち消す。実装（`classifyFriend`）は
              「はじめて」か「以前から」のどちらか一方だけを返し、①と②が
              同時に走ることはない。②で「はじめての人と同じもの」を選んだ
              ときだけ、②に振り分けられた人へ①の内容が届く。
            */}
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              1人の友だちは①と②のどちらか一方にだけ振り分けられ、両方が動くことはありません（②で「はじめての人と同じもの」を選んだときだけ、②に振り分けられた人へ①の内容が届きます）。
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="はじめての人の判定">
                <Select
                  value={routing.criteria.firstTime}
                  onChange={v =>
                    patch({
                      criteria: { firstTime: v as FriendAddRouting['criteria']['firstTime'] },
                    })
                  }
                  options={[
                    { id: 'unfollow_count_zero', name: 'ブロックされた回数が0回' },
                    { id: 'first_followed_at_missing', name: '初回フォロー日が未記録' },
                  ]}
                  ariaLabel="初回の友だちを判定する基準"
                />
              </Field>
              <Field label="ブロック解除の判定">
                {/* 選択肢が1つしかない。ブロック解除は unfollow_count でしか
                    見分けられず、他に材料が無い。押せる形にすると
                    「他にも選べる」と誤解される。 */}
                <div className="border-hairline text-ink-secondary rounded-control bg-canvas-sunken border px-3 py-2 text-sm">
                  ブロック解除の回数が1回以上
                </div>
              </Field>
            </div>
            {routing.criteria.firstTime === 'first_followed_at_missing' && (
              <p className="bg-warning-bg text-warning rounded-card mt-3 px-3 py-2 text-xs leading-relaxed">
                この基準は、いまのデータでは使えません。過去に追加された友だちにも
                あとから初回フォロー日を記録したため、未記録の人がもう居ません。
                このままだと全員が「以前から」に振り分けられます。
              </p>
            )}
          </section>
        </div>

        {/* どう振り分けられるか */}
        <aside data-design="Flow" className="w-full shrink-0 xl:w-[380px]">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">どう振り分けられるか</h2>
            <div className="mt-4 space-y-2">
              <FlowBox title="友だち追加された" note="LINEから追加の通知が届く" tone="accent" />
              <FlowArrow />
              <FlowBox
                title={
                  routing.criteria.firstTime === 'unfollow_count_zero'
                    ? 'ブロックされたことがある？'
                    : '初回フォロー日は記録済み？'
                }
                /* 運用者はテーブル名も列名も知らない。画面には、何を見て
                   決めているかを運用の言葉で書く。 */
                note={
                  routing.criteria.firstTime === 'unfollow_count_zero'
                    ? 'これまでにブロックされた回数を見る'
                    : '初回フォロー日の記録があるかを見る'
                }
              />
              <FlowArrow />

              <FlowBadge
                label={routing.criteria.firstTime === 'unfollow_count_zero' ? '0回 = はじめて' : '未記録 = はじめて'}
                count={breakdown?.firstTime}
                tone="accent"
              />
              <FlowBox
                title={
                  scenarioName(routing.firstTime.scenarioId)
                    ? `シナリオ「${scenarioName(routing.firstTime.scenarioId)}」`
                    : '有効な友だち追加シナリオを全部'
                }
                note={
                  routing.firstTime.timing === 'immediate'
                    ? 'すぐに配信 ・ 最初から'
                    : 'シナリオの設定どおり ・ 最初から'
                }
              />
              <ActionSummary actions={routing.firstTime.actions} tags={tags} />

              <FlowBadge
                label={routing.criteria.firstTime === 'unfollow_count_zero' ? '1回以上 = 以前から' : '記録あり = 以前から'}
                count={breakdown?.returning}
                tone="warning"
              />
              {routing.returning.mode === 'none' ? (
                <FlowBox title="何も配信しない" note="既存のお客さまには送らない" tone="muted" />
              ) : routing.returning.mode === 'same' ? (
                <FlowBox
                  title="はじめての人と同じもの"
                  note="以前からのお客さまにも「はじめまして」が届く"
                  tone="warning"
                />
              ) : (
                <FlowBox
                  title={
                    scenarioName(routing.returning.scenarioId)
                      ? `シナリオ「${scenarioName(routing.returning.scenarioId)}」`
                      : 'シナリオが未選択'
                  }
                  note={
                    routing.returning.startPosition === 'resume'
                      ? '前回読んだところから'
                      : '最初から'
                  }
                  tone="warning"
                />
              )}
              <ActionSummary actions={routing.returning.actions} tags={tags} />
            </div>

            <div className="border-hairline mt-4 border-t pt-3">
              <p className="text-ink text-xs font-bold">この1か月の実績</p>
              <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
                {breakdownError
                  ? '実績を読み込めませんでした。画面を再読み込みしてください。'
                  : breakdown
                  ? `はじめて ${breakdown.firstTime}人 ・ 以前から ${breakdown.returning}人。うち${breakdown.unblocked}人はブロック解除でした。`
                  : '読み込んでいます'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── 部品 ────────────────────────────────────────────────────────────────────

function SectionTitle({
  number,
  title,
  description,
  tone,
}: {
  number: number
  title: string
  description: string
  tone: 'accent' | 'warning'
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-xs font-bold text-white ${
          tone === 'accent' ? 'bg-accent' : 'bg-warning'
        }`}
      >
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-ink text-base font-bold">{title}</h2>
        <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-ink-secondary mb-1 block text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  ariaLabel: string
}) {
  return (
    <SelectField
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
      options={[
        ...(placeholder ? [{ value: '', label: placeholder }] : []),
        ...options.map((option) => ({ value: option.id, label: option.name })),
      ]}
    />
  )
}

function RadioRow({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-control flex w-full items-start gap-3 border p-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas hover:bg-canvas-sunken'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border-2 ${
          selected ? 'border-accent' : 'border-hairline'
        }`}
      >
        {selected && <span className="bg-accent h-2 w-2 rounded-pill" />}
      </span>
      <span className="min-w-0">
        <span className="text-ink block text-sm font-bold">{title}</span>
        <span className="text-ink-secondary mt-0.5 block text-xs leading-relaxed">{description}</span>
      </span>
    </button>
  )
}

/** 「あわせて実行すること」。受け口があるのはタグ付与とマイル付与だけ。 */

/** 画面で選べるアクション。シナリオ側の種類を、選びやすい言葉に開いてある。 */
type ActionKind =
  | 'tag_add'
  | 'tag_remove'
  | 'support_mark_set'
  | 'support_mark_clear'
  | 'friend_field'
  | 'scenario_start'
  | 'mile'

const ACTION_KINDS: { id: ActionKind; name: string }[] = [
  { id: 'tag_add', name: 'タグを付ける' },
  { id: 'tag_remove', name: 'タグを外す' },
  { id: 'support_mark_set', name: '対応マークを付ける' },
  { id: 'support_mark_clear', name: '対応マークを外す' },
  { id: 'friend_field', name: '友だち情報欄に入れる' },
  { id: 'scenario_start', name: '別のシナリオを開始する' },
  { id: 'mile', name: 'マイルを付与' },
]

/**
 * チップと要約に出す言葉。
 *
 * 中身は `config` にシナリオ側の形で入っているので、ここで読み解く。
 * 読めない形は「設定を確認してください」と出す。**黙って何も出さないと、
 * 設定したつもりで消えたように見える。**
 */
function actionLabel(a: FriendAddAction, tags: Option[]): string {
  if (a.kind === 'mile') return `マイル ${a.amount} を付与`
  if (a.kind === 'tag') return `タグ「${tags.find(t => t.id === a.tagId)?.name ?? '?'}」を付ける`

  const c = (a.config ?? {}) as Record<string, unknown>
  const name = (id: unknown) => tags.find(t => t.id === id)?.name ?? '?'
  switch (a.actionType) {
    case 'tag': {
      const ids = Array.isArray(c.tagIds) ? (c.tagIds as unknown[]) : []
      const label = ids.map(name).join('・') || '?'
      return c.op === 'remove' ? `タグ「${label}」を外す` : `タグ「${label}」を付ける`
    }
    case 'support_mark':
      return c.markId ? '対応マークを付ける' : '対応マークを外す'
    case 'friend_field':
      return `友だち情報欄に「${String(c.value ?? '')}」を入れる`
    case 'scenario':
      return c.op === 'start' ? '別のシナリオを開始する' : 'シナリオを操作する'
    case 'common_var':
      return '共通情報を変える'
    default:
      return '設定を確認してください'
  }
}

function ActionChips({
  actions,
  tags,
  marks,
  fields,
  scenarios,
  onChange,
}: {
  actions: FriendAddAction[]
  tags: Option[]
  marks: Option[]
  fields: Option[]
  scenarios: Option[]
  onChange: (actions: FriendAddAction[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const label = (a: FriendAddAction) => actionLabel(a, tags)

  return (
    <div className="mt-4">
      <p className="text-ink-secondary mb-2 text-xs font-medium">あわせて実行すること</p>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a, i) => (
          <span
            key={`${a.kind}-${i}`}
            className="bg-accent-soft text-accent rounded-pill inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium"
          >
            {label(a)}
            <button
              type="button"
              onClick={() => onChange(actions.filter((_, j) => j !== i))}
              className="text-accent/70 hover:text-accent"
              aria-label="外す"
            >
              ×
            </button>
          </span>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-pill border border-dashed px-3 py-1 text-xs"
          >
            ＋ 追加
          </button>
        )}
      </div>
      {adding && (
        <ActionEditor
          tags={tags}
          marks={marks}
          fields={fields}
          scenarios={scenarios}
          onCancel={() => setAdding(false)}
          onAdd={a => {
            onChange([...actions, a])
            setAdding(false)
          }}
        />
      )}
      <p className="text-ink-faint mt-2 text-xs leading-relaxed">
        シナリオのアクションと同じものが使えます。流入元の記録は友だち追加のたびに必ず走るので、ここでは選びません。担当者への通知は受け口がまだありません。
      </p>
    </div>
  )
}

function ActionEditor({
  tags,
  marks,
  fields,
  scenarios,
  onAdd,
  onCancel,
}: {
  tags: Option[]
  marks: Option[]
  fields: Option[]
  scenarios: Option[]
  onAdd: (action: FriendAddAction) => void
  onCancel: () => void
}) {
  /*
   * 種類はシナリオのアクションと同じものを並べる。以前は「タグを付ける」と
   * 「マイルを付与」の2つだけで、タグを外すこともフォルダで指定することも
   * できなかった。実行はシナリオと同じところを通る。
   */
  const [kind, setKind] = useState<ActionKind>('tag_add')
  const [tagId, setTagId] = useState(tags[0]?.id ?? '')
  const [amount, setAmount] = useState(100)
  const [markId, setMarkId] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [scenarioId, setScenarioId] = useState('')

  const canAdd =
    kind === 'tag_add' || kind === 'tag_remove' ? Boolean(tagId)
    : kind === 'mile' ? amount > 0
    : kind === 'support_mark_set' ? Boolean(markId)
    : kind === 'support_mark_clear' ? true
    : kind === 'friend_field' ? Boolean(fieldId)
    : kind === 'scenario_start' ? Boolean(scenarioId)
    : false

  const build = (): FriendAddAction => {
    switch (kind) {
      case 'tag_add':
        return { kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [tagId] } }
      case 'tag_remove':
        return { kind: 'row', actionType: 'tag', config: { op: 'remove', tagIds: [tagId] } }
      case 'support_mark_set':
        return { kind: 'row', actionType: 'support_mark', config: { markId } }
      case 'support_mark_clear':
        return { kind: 'row', actionType: 'support_mark', config: { markId: null } }
      case 'friend_field':
        return { kind: 'row', actionType: 'friend_field', config: { fieldId, op: 'set', value: fieldValue } }
      case 'scenario_start':
        return { kind: 'row', actionType: 'scenario', config: { op: 'start', scenarioId, restart: 'from_start' } }
      default:
        return { kind: 'mile', amount }
    }
  }

  return (
    <div className="border-hairline rounded-control mt-2 flex flex-wrap items-end gap-2 border p-3">
      <Field label="種類">
        <Select
          value={kind}
          onChange={v => setKind(v as ActionKind)}
          options={ACTION_KINDS as unknown as Option[]}
          ariaLabel="友だち追加時に行うアクションの種類"
        />
      </Field>
      {(kind === 'tag_add' || kind === 'tag_remove') && (
        <Field label="タグ">
          <Select value={tagId} onChange={setTagId} options={tags} placeholder="選んでください" ariaLabel="友だち追加時に操作するタグ" />
        </Field>
      )}
      {kind === 'support_mark_set' && (
        <Field label="対応マーク">
          <Select value={markId} onChange={setMarkId} options={marks} placeholder="選んでください" ariaLabel="友だち追加時に付ける対応マーク" />
        </Field>
      )}
      {kind === 'friend_field' && (
        <>
          <Field label="友だち情報欄">
            <Select value={fieldId} onChange={setFieldId} options={fields} placeholder="選んでください" ariaLabel="友だち追加時に更新する友だち情報欄" />
          </Field>
          <Field label="入れる値">
            <input
              value={fieldValue}
              onChange={e => setFieldValue(e.target.value)}
              placeholder="例: 友だち追加"
              className="border-hairline rounded-control bg-canvas text-ink w-40 border px-3 py-2 text-sm"
            />
          </Field>
        </>
      )}
      {kind === 'scenario_start' && (
        <Field label="シナリオ">
          <Select value={scenarioId} onChange={setScenarioId} options={scenarios} placeholder="選んでください" ariaLabel="友だち追加時に開始するシナリオ" />
        </Field>
      )}
      {kind === 'mile' && (
        <Field label="マイル">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            className="border-hairline rounded-control bg-canvas text-ink w-28 border px-3 py-2 text-sm"
          />
        </Field>
      )}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => onAdd(build())}
        className="bg-accent-deep text-on-accent rounded-control px-3 py-2 text-xs font-bold disabled:opacity-50"
      >
        入れる
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-ink-secondary rounded-control px-3 py-2 text-xs"
      >
        やめる
      </button>
    </div>
  )
}

function ActionSummary({ actions, tags }: { actions: FriendAddAction[]; tags: Option[] }) {
  if (actions.length === 0) return null
  const text = actions.map(a => actionLabel(a, tags)).join(' ・ ')
  return (
    <div className="border-hairline rounded-control bg-canvas-sunken text-ink-secondary border px-3 py-2 text-xs">
      {text}
    </div>
  )
}

function FlowBox({
  title,
  note,
  tone = 'plain',
}: {
  title: string
  note: string
  tone?: 'plain' | 'accent' | 'warning' | 'muted'
}) {
  const skin =
    tone === 'accent'
      ? 'border-accent/30 bg-accent-soft'
      : tone === 'warning'
        ? 'border-warning/30 bg-warning-bg'
        : tone === 'muted'
          ? 'border-hairline bg-canvas-sunken'
          : 'border-hairline bg-canvas'
  return (
    <div className={`rounded-control border px-3 py-2 ${skin}`}>
      <p className="text-ink text-xs font-bold">{title}</p>
      <p className="text-ink-faint mt-0.5 text-[11px] leading-relaxed">{note}</p>
    </div>
  )
}

function FlowArrow() {
  return <p className="text-ink-faint text-center text-xs">↓</p>
}

function FlowBadge({
  label,
  count,
  tone,
}: {
  label: string
  count: number | undefined
  tone: 'accent' | 'warning'
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <span
        className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${
          tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-warning-bg text-warning'
        }`}
      >
        {label}
      </span>
      <span className="text-ink-faint text-[11px]">
        今月 {count === undefined ? '…' : `${count}人`}
      </span>
    </div>
  )
}

/**
 * テスト実行。**登録も配信もしない。**
 * 友だちを1人選んで、いまの設定でどちらに振り分けられるかだけを見る。
 */
function TestRunButton({
  accountId,
  scenarioName,
}: {
  accountId: string
  scenarioName: (id: string | null) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [friendId, setFriendId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const run = async () => {
    if (!friendId.trim()) return
    setRunning(true)
    setResult(null)
    const res = await api.friendAddRouting.test(accountId, friendId.trim())
    setRunning(false)
    if (!res.success) {
      setResult(res.error)
      return
    }
    const d = res.data
    const where = d.kind === 'first_time' ? 'はじめての人' : '以前からの友だち'
    const to = d.suppressed
      ? '何も配信されません'
      : scenarioName(d.scenarioId)
        ? `シナリオ「${scenarioName(d.scenarioId)}」が流れます`
        : '有効な友だち追加シナリオが全部流れます'
    setResult(
      `${d.displayName ?? friendId} は「${where}」に振り分けられ、${to}。（ブロックされた回数 ${d.unfollowCount}）`,
    )
  }

  const label = useMemo(() => (running ? '確認中…' : 'テスト実行'), [running])

  return (
    // パネルは絶対配置なので、基準になる relative をここに置く。
    // 無いと body 基準になって、画面の左上に出る。
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm"
      >
        テスト実行
      </button>
      {open && (
        <div className="border-hairline bg-canvas rounded-card absolute right-0 z-20 mt-2 w-[min(90vw,420px)] border p-4 shadow-lg">
          <p className="text-ink text-sm font-bold">テスト実行</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            友だちのIDを入れると、その人がどちらに振り分けられるかだけを返します。
            <strong className="text-ink">登録も配信もしません。</strong>
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={friendId}
              onChange={e => setFriendId(e.target.value)}
              placeholder="友だちID"
              className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={run}
              disabled={running || !friendId.trim()}
              className="bg-accent-deep text-on-accent rounded-control px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              {label}
            </button>
          </div>
          {result && (
            <p className="bg-canvas-sunken text-ink-secondary rounded-control mt-3 px-3 py-2 text-xs leading-relaxed">
              {result}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
