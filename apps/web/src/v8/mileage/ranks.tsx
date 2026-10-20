'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RankProgram, RankTier } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import HelpTip from '@/components/shared/help-tip'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import NumberField from '@/components/shared/number-field'
import { SettingCheckbox } from '@/components/shared/checkbox'
import { RowMenu } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import StatusBadge from '@/components/shared/status-badge'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import TruncatedText from '@/components/shared/truncated-text'
import { TextArea, TextField } from '@/components/shared/text-field'
import { notifySaved } from '@/components/shared/toast'
import { ApiError } from '@/lib/api'
import { useAccount as useAccountContext } from '@/contexts/account-context'
import { memberRanksApi } from '@/lib/api/helpers/gap3'
import { formatNumber } from '@/lib/format'
import { ListPageSection } from '@/components/templates/list-page'
import PreviewLauncher from '@/components/templates/preview-launcher'
import { MileageFrame, useMileageShell } from './frame'
import styles from './ranks.module.css'

/*
 * ★V8 マイル「会員ランク」（G5-2 `QpgfW`）。段の表（名前・上がる条件・下がる条件・特典・今の人数）と、
 * 右の LINE の見本（上がったとき／下がる前）。動かす前は「止めている」の札と［動かす］（確かめの窓に段ごとの人数）。
 * 通知・倍率を実際のマイルへ掛ける処理はまだ無いので、見本と「準備中」の注記で見せる。
 * 段を保存するといったん止まる（Worker の決まり）。閲覧のみの人には変える操作を置かない。
 */

const METRIC_OPTIONS: Array<{ value: RankProgram['metric']; label: string }> = [
  { value: 'visits', label: '来店の回数' },
  { value: 'amount', label: '購入の金額' },
  { value: 'miles', label: 'たまったマイル' },
]
const WINDOW_OPTIONS = [3, 6, 12, 24, 36]
const METRIC_UNIT: Record<RankProgram['metric'], string> = { visits: '回', amount: '円', miles: 'マイル' }

function windowLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} 年` : `${months} か月`
}

function upText(program: RankProgram, tier: RankTier, first: boolean): string {
  if (first || tier.threshold === 0) return '友だちになったら'
  const term = windowLabel(program.windowMonths)
  const n = formatNumber(tier.threshold)
  if (program.metric === 'visits') return `${term}で ${n} 回以上来店`
  if (program.metric === 'amount') return `${term}で ${n} 円以上購入`
  return `${term}で ${n} マイル以上`
}

function downText(program: RankProgram, tier: RankTier): string {
  const term = windowLabel(program.windowMonths)
  const n = formatNumber(tier.threshold)
  if (program.metric === 'visits') return `${term}で ${n} 回未満`
  if (program.metric === 'amount') return `${term}で ${n} 円未満`
  return `${term}で ${n} マイル未満`
}

function failureText(reason: unknown, doing: string): string {
  const code = reason instanceof ApiError ? reason.code : undefined
  if (code === 'version_conflict') return '別の人が先に変えていました。読み直したので、もう一度お試しください。'
  if (code === 'invalid_tiers') return '段の入力を直してください。名前・上がる条件（上の段ほど大きく）・特典の倍率（1〜3）を確かめます。'
  if (reason instanceof ApiError && reason.status === 403) return `${doing}権限がありません。オーナーか管理者に頼んでください。`
  return `${doing}ことができませんでした。時間をおいてもう一度お試しください。`
}

type Preview = { byTier: Array<{ tierId: string; name: string; count: number }>; wouldUpgrade: number; wouldDowngrade: number }

export default function RanksTab() {
  const { readonly, narrow } = useMileageShell()
  const accountId = useAccountId()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<unknown>(null)
  const [program, setProgram] = useState<RankProgram | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [notice, setNotice] = useState('')
  const [edit, setEdit] = useState<{ index: number | null } | null>(null)
  const [confirm, setConfirm] = useState<'activate' | 'stop' | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const [sample, setSample] = useState<'up' | 'down'>('up')
  const [menuIndex, setMenuIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setStatus('loading')
    try {
      const response = await memberRanksApi.program(accountId)
      if (!response.success) throw new Error('program_failed')
      setProgram(response.data)
      setStatus('ready')
      const counts = await memberRanksApi.preview(accountId).catch(() => null)
      setPreview(counts && counts.success ? counts.data : null)
    } catch (reason) {
      setError(reason)
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const tiers = useMemo(() => program?.tiers ?? [], [program])
  const countOf = (id: string) => preview?.byTier.find((item) => item.tierId === id)?.count

  const run = async (doing: string, action: () => Promise<{ success: boolean }>, done: string) => {
    setBusy(true)
    setNotice('')
    try {
      const response = await action()
      if (!response.success) throw new Error('failed')
      notifySaved(done)
      await load()
      return true
    } catch (reason) {
      setNotice(failureText(reason, doing))
      await load()
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveProgram = (next: Partial<Pick<RankProgram, 'metric' | 'windowMonths' | 'notifyUpgrade' | 'notifyDowngrade'>>) => {
    if (!accountId || !program) return
    void run('保存する', () => memberRanksApi.save(accountId, { metric: next.metric ?? program.metric, windowMonths: next.windowMonths ?? program.windowMonths, notifyUpgrade: next.notifyUpgrade ?? program.notifyUpgrade, notifyDowngrade: next.notifyDowngrade ?? program.notifyDowngrade, expectedVersion: program.version }), 'ランクの設定を保存しました。')
  }

  const saveTiers = async (next: RankTier[]) => {
    if (!accountId || !program) return false
    return run('保存する', () => memberRanksApi.tiers(accountId, next, program.version), '段を保存しました。いったん止まっているので、確かめて動かしてください。')
  }

  const activeLabel = program?.status === 'active' ? '動かしている' : '止めている'

  const table = !program ? null : (
    <DataTable columnWeights={[1.1, 2.2, 1.7, 1.7, 1.1, 0.5]}>
      <thead>
        <TableHeadRow>
          <Th>ランク</Th>
          <Th grow>上がる条件</Th>
          <Th>下がる条件</Th>
          <Th>特典</Th>
          <Th align="right">今の人数</Th>
          <Th>操作</Th>
        </TableHeadRow>
      </thead>
      <tbody>
        {tiers.map((tier, index) => {
          const count = countOf(tier.id)
          return (
            <Tr key={tier.id} data-row-id={tier.id}>
              <Td><StatusBadge tone={index === 0 ? 'neutral' : index === tiers.length - 1 ? 'warning' : 'info'} dot={false}>{tier.name}</StatusBadge></Td>
              <Td grow><TruncatedText value={upText(program, tier, index === 0)} /></Td>
              <Td>{index === 0 ? <span className={styles.unavailableValue}>—</span> : downText(program, tier)}</Td>
              <Td>
                {tier.mileMultiplier > 1
                  ? <>{`${tier.mileMultiplier} 倍`}{tier.benefitDescriptions?.length ? <span className={styles.sub} title={tier.benefitDescriptions.join(' ・ ')}>{tier.benefitDescriptions.join(' ・ ')}</span> : null}</>
                  : tier.benefitDescriptions?.length ? <span title={tier.benefitDescriptions.join(' ・ ')}>{tier.benefitDescriptions.join(' ・ ')}</span> : <span className={styles.unavailableValue}>—</span>}
              </Td>
              <Td align="right">{count === undefined ? <span className={styles.unavailableValue}>—</span> : `${formatNumber(count)} 人`}</Td>
              <ActionCell>
                {readonly ? null : (
                  <span className={styles.menuBox}>
                    <RowMenu
                      label={`${tier.name}の操作`}
                      open={menuIndex === index}
                      onOpenChange={(next) => setMenuIndex(next ? index : null)}
                      items={[
                        { id: 'edit', label: '編集する', onSelect: () => setEdit({ index }) },
                        ...(index === 0 || tiers.length <= 2 ? [] : [{ id: 'delete', label: '削除する', onSelect: () => setDeleteIndex(index) }]),
                      ]}
                    />
                  </span>
                )}
              </ActionCell>
            </Tr>
          )
        })}
      </tbody>
    </DataTable>
  )

  const sampleTier = tiers[tiers.length > 1 ? 1 : 0]
  const messageOf = (list?: Array<{ text: string }>) => list?.map((m) => m.text).join('\n') ?? ''
  const sampleCustom = sample === 'up' ? messageOf(sampleTier?.upgradeMessages) : messageOf(sampleTier?.downgradeMessages)
  const sampleText = sampleCustom ? sampleCustom : sample === 'up'
    ? `${sampleTier?.name ?? 'ゴールド'}になりました。いつもありがとうございます。今日からマイルが ${sampleTier?.mileMultiplier ?? 1.5} 倍です。`
    : `あと 1 回のご来店で、${sampleTier?.name ?? 'ゴールド'}のままです。期限は 14 日後です。`

  const previewBody = (
    <>
      <SegmentedControl aria-label="LINE の見本" options={[{ value: 'up', label: '上がったとき' }, { value: 'down', label: '下がる前' }]} value={sample} onChange={setSample} />
      <LinePreview title={sample === 'up' ? '上がったときの LINE' : '下がる前の LINE'} fit note="見本です。通知はまだ送れません。" caption="見本">
        <LinePreviewMessage accountName="お店" avatar="店" time="10:00">{sampleText}</LinePreviewMessage>
      </LinePreview>
    </>
  )

  const body = status === 'loading' && !program ? (
    <ListState kind="loading" title="会員ランクを読み込んでいます" />
  ) : status === 'error' ? (
    <ListState kind="error" error={error} onRetry={() => void load()} />
  ) : (
    <ListPageSection><div className={narrow ? `${styles.layout} ${styles.layoutNarrow}` : styles.layout}>
      <div className={styles.main}>
        {notice ? <Notice tone="danger" message={notice} /> : null}
        <section className={styles.card} aria-label="ランクの段">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>ランクの段</h3>
            <HelpTip label="ランクの段の説明">来店の回数・購入の金額・たまったマイルで段を決めます。段ごとに特典を付けられます。条件を下回っても、14 日の猶予のあとに 1 つ下がります。</HelpTip>
            <span className={styles.cardEnd}>
              <StatusBadge tone={program?.status === 'active' ? 'success' : 'neutral'}>{activeLabel}</StatusBadge>
              {readonly || !program || tiers.length === 0 ? null : (
                program.status === 'active'
                  ? <Button variant="secondary" onClick={() => setConfirm('stop')} disabled={busy}>止める</Button>
                  : <Button variant="primary" onClick={() => setConfirm('activate')} disabled={busy}>動かす</Button>
              )}
            </span>
          </div>
          {program && !readonly ? (
            <div className={styles.settings}>
              <span className={styles.settingsLabel}>数える物</span>
              <Select aria-label="数える物" value={program.metric} options={METRIC_OPTIONS} onChange={(value) => saveProgram({ metric: value as RankProgram['metric'] })} disabled={busy} />
              <span className={styles.settingsLabel}>期間</span>
              <SettingCheckbox checked={program.notifyUpgrade} label="上がったときに知らせる" onChange={(checked) => saveProgram({ notifyUpgrade: checked })} disabled={busy} />
              <span className={styles.settingsLabel}>上がったときに知らせる</span>
              <SettingCheckbox checked={program.notifyDowngrade} label="下がる前に知らせる" onChange={(checked) => saveProgram({ notifyDowngrade: checked })} disabled={busy} />
              <span className={styles.settingsLabel}>下がる前に知らせる</span>
              <Select aria-label="数える期間" value={String(program.windowMonths)} options={Array.from(new Set([...WINDOW_OPTIONS, program.windowMonths])).sort((a, b) => a - b).map((value) => ({ value: String(value), label: windowLabel(value) }))} onChange={(value) => saveProgram({ windowMonths: Number(value) })} disabled={busy} />
            </div>
          ) : null}
          {tiers.length === 0 ? (
            <ListState kind="empty" title="まだランクがありません" description="段を足すと、来店や購入に合わせて会員ランクを付けられます。" />
          ) : table}
          <p className={styles.note}>条件を下回っても、14 日の猶予のあとに 1 つ下がります。下がる 14 日前にお知らせします（今は試験運転で、LINE へは送らず記録だけ残します）。段を保存すると、いったん止まります。</p>
        </section>
      </div>
      {narrow ? <div className={styles.launcher}>
        <PreviewLauncher title="LINE の見本" label="LINEでの見え方を見る">{previewBody}</PreviewLauncher>
      </div> : <div className={styles.previewCol}>{previewBody}</div>}
    </div></ListPageSection>
  )

  const actions = readonly || !program ? null : (
    <Button variant="primary" onClick={() => setEdit({ index: null })} disabled={tiers.length >= 5} title={tiers.length >= 5 ? '段は 5 つまでです' : undefined}>ランクを足す</Button>
  )

  return (
    <MileageFrame actions={actions} help="段ごとの条件と特典を決めます。動かすと、全員に今の成績で段が付きます。">
      {body}
      {edit && program ? (
        <TierDialog
          tier={edit.index === null ? null : tiers[edit.index]}
          program={program}
          prev={edit.index === null ? tiers[tiers.length - 1] ?? null : tiers[edit.index - 1] ?? null}
          next={edit.index === null ? null : tiers[edit.index + 1] ?? null}
          isFirst={edit.index === 0 || (edit.index === null && tiers.length === 0)}
          busy={busy}
          onCancel={() => setEdit(null)}
          onSave={async (tier) => {
            const list = edit.index === null ? [...tiers, tier] : tiers.map((item, i) => (i === edit.index ? tier : item))
            if (await saveTiers(list)) setEdit(null)
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleteIndex !== null}
        title={deleteIndex !== null ? `「${tiers[deleteIndex]?.name ?? ''}」を削除しますか？` : ''}
        description="その段にいた人は、1 つ下の段になります。段を保存するといったん止まります。"
        confirmLabel="削除する"
        destructive
        busy={busy}
        onConfirm={async () => { if (deleteIndex !== null && await saveTiers(tiers.filter((_, i) => i !== deleteIndex))) setDeleteIndex(null) }}
        onCancel={() => setDeleteIndex(null)}
      />
      <Dialog
        open={confirm !== null}
        title={confirm === 'activate' ? '会員ランクを動かしますか？' : '会員ランクを止めますか？'}
        confirmLabel={confirm === 'activate' ? '動かす' : '止める'}
        busy={busy}
        onConfirm={() => {
          if (!accountId || !program) return
          const action = confirm === 'activate'
            ? () => memberRanksApi.activate(accountId, program.version, crypto.randomUUID())
            : () => memberRanksApi.stop(accountId, program.version)
          void run(confirm === 'activate' ? '動かす' : '止める', action, confirm === 'activate' ? '会員ランクを動かしました。' : '会員ランクを止めました。').then((ok) => { if (ok) setConfirm(null) })
        }}
        onCancel={() => setConfirm(null)}
      >
        <div className={styles.dialogBody}>
          {confirm === 'activate' ? (
            <>
              <p className={styles.note}>動かすと、全員に今の成績で段が付きます。最初は LINE を送りません。</p>
              <ul className={styles.windowList} aria-label="段ごとの人数">
                {(preview?.byTier ?? []).map((item) => (
                  <li key={item.tierId} className={styles.windowRow}><span>{item.name}</span><span>{`${formatNumber(item.count)} 人`}</span></li>
                ))}
              </ul>
              {preview ? <p className={styles.note}>{`上がる人 ${formatNumber(preview.wouldUpgrade)} 人・下がる人 ${formatNumber(preview.wouldDowngrade)} 人`}</p> : null}
            </>
          ) : (
            <p className={styles.note}>止めると、段の判定とランクのタグの付け外しが止まります。今の段は残ります。</p>
          )}
        </div>
      </Dialog>
    </MileageFrame>
  )
}

function useAccountId(): string | null {
  const { selectedAccountId } = useAccountContext()
  return selectedAccountId
}

function TierDialog({ tier, program, prev, next, isFirst, busy, onCancel, onSave }: {
  tier: RankTier | null
  program: RankProgram
  prev: RankTier | null
  next: RankTier | null
  isFirst: boolean
  busy: boolean
  onCancel: () => void
  onSave: (tier: RankTier) => void
}) {
  const [name, setName] = useState(tier?.name ?? '')
  const [threshold, setThreshold] = useState(String(tier?.threshold ?? (prev ? prev.threshold + 1 : 0)))
  const [multiplier, setMultiplier] = useState(String(tier?.mileMultiplier ?? 1))
  const [benefits, setBenefits] = useState((tier?.benefitDescriptions ?? []).join('\n'))
  const [coupon, setCoupon] = useState(tier?.couponCode ?? '')
  const [upText, setUpText] = useState((tier?.upgradeMessages ?? []).map((m) => m.text).join('\n'))
  const [downText, setDownText] = useState((tier?.downgradeMessages ?? []).map((m) => m.text).join('\n'))
  const [errors, setErrors] = useState<{ name?: string; threshold?: string; multiplier?: string }>({})

  const submit = () => {
    const found: typeof errors = {}
    const th = Number(threshold)
    const mul = Number(multiplier)
    if (!name.trim()) found.name = '名前を入れてください。'
    else if (name.trim().length > 30) found.name = '名前は 30 文字までです。'
    if (isFirst) { if (th !== 0) found.threshold = '最初の段の条件は 0 です。' }
    else if (!Number.isInteger(th) || th < 0) found.threshold = '0 以上の整数を入れてください。'
    else if (prev && th <= prev.threshold) found.threshold = `下の段（${prev.threshold}）より大きくしてください。`
    else if (next && th >= next.threshold) found.threshold = `上の段（${next.threshold}）より小さくしてください。`
    if (!Number.isFinite(mul) || mul < 1 || mul > 3) found.multiplier = '1〜3 の数を入れてください。'
    setErrors(found)
    if (Object.keys(found).length) return
    const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)
    onSave({
      ...(tier ?? {}),
      id: tier?.id ?? crypto.randomUUID(), name: name.trim(), threshold: isFirst ? 0 : th, mileMultiplier: mul,
      benefitDescriptions: lines(benefits),
      couponCode: coupon.trim() || null,
      upgradeMessages: lines(upText).slice(0, 5).map((text) => ({ type: 'text' as const, text })),
      downgradeMessages: lines(downText).slice(0, 5).map((text) => ({ type: 'text' as const, text })),
    })
  }

  return (
    <Dialog open contentLayout="form" title={tier ? 'ランクを編集する' : 'ランクを足す'} confirmLabel="保存する" busy={busy} onConfirm={submit} onCancel={onCancel}>
      <div className={styles.dialogBody}>
        <Field label="名前" required error={errors.name}><TextField aria-label="名前" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="上がる条件" required error={errors.threshold} note={isFirst ? '最初の段は、友だちになったら入ります。' : `${windowLabel(program.windowMonths)}の ${METRIC_OPTIONS.find((item) => item.value === program.metric)?.label ?? ''}`}>
          <NumberField short aria-label="上がる条件" value={threshold} unit={METRIC_UNIT[program.metric]} min={0} disabled={isFirst} onChange={(event) => setThreshold(event.target.value)} />
        </Field>
        <Field label="特典（マイルの倍率）" error={errors.multiplier} note="1 は特典なし。上の段ほど大きくします（1〜3）。">
          <NumberField short aria-label="特典（マイルの倍率）" value={multiplier} unit="倍" min={1} max={3} step={0.1} onChange={(event) => setMultiplier(event.target.value)} />
        </Field>
        <Field label="特典の説明" note="1 行に 1 つ。お客さまの会員証に出ます（10 個まで）。"><TextArea aria-label="特典の説明" value={benefits} rows={3} onChange={(event) => setBenefits(event.target.value)} /></Field>
        <Field label="クーポンコード" note="上がったときのお知らせに添えます。"><TextField aria-label="クーポンコード" value={coupon} maxLength={100} onChange={(event) => setCoupon(event.target.value)} /></Field>
        <Field label="上がったときのお知らせ" note="1 行が 1 通。空のままなら、決まった文を使います。"><TextArea aria-label="上がったときのお知らせ" value={upText} rows={3} onChange={(event) => setUpText(event.target.value)} /></Field>
        <Field label="下がる前のお知らせ" note="下がる 14 日前に。空のままなら、決まった文を使います。"><TextArea aria-label="下がる前のお知らせ" value={downText} rows={3} onChange={(event) => setDownText(event.target.value)} /></Field>
      </div>
    </Dialog>
  )
}
