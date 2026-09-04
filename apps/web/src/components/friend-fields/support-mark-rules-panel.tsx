'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { ApiError, api, type SupportMarkAutomationEvent, type SupportMarkAutomationRule } from '@/lib/api'
import {
  EVENT_LABELS,
  LIST_EMPTY,
  LIST_ERROR,
  MULTI_MATCH_NOTE,
  PRIORITY_MAX,
  PRIORITY_MIN,
  PROTECTION_MAX,
  activeText,
  eventLabel,
  failureOf,
  inExecutionOrder,
  isCurrentResponse,
  protectionText,
  saveCallOf,
  toRuleBody,
  validateRule,
  type Failure,
  type RequestAt,
} from './support-mark-rules-view'
import styles from './support-mark-rules-panel.module.css'

type Draft = {
  name: string
  event: SupportMarkAutomationEvent
  priority: string
  manualProtectionMinutes: string
  isActive: boolean
}

const EMPTY_DRAFT: Draft = {
  name: '', event: 'staff_assigned', priority: '0', manualProtectionMinutes: '0', isActive: true,
}

const draftOf = (rule: SupportMarkAutomationRule): Draft => ({
  name: rule.name,
  event: rule.event,
  priority: String(rule.priority),
  manualProtectionMinutes: String(rule.manualProtectionMinutes),
  isActive: rule.isActive,
})

/**
 * 対応マークの自動変更ルール（設計 `GMvBd` 4-3-A）。
 *
 * **名前・色・並び順・初期値と同じ面に置く。** 別画面にすると、
 * 「このマークがいつ付くのか」を見るのに行き来することになる。
 *
 * ルールの正本は `automation_definitions` / `automation_versions`。
 * 公開版は書き換えず、直すたびに新しい版が作られる。削除は履歴を残す
 * アーカイブで、消去ではない。
 */
export default function SupportMarkRulesPanel({
  accountId,
  markId,
  markName,
}: {
  accountId: string | null
  markId: string | null
  markName: string
}) {
  const [rules, setRules] = useState<SupportMarkAutomationRule[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'not-connected'>('loading')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [touched, setTouched] = useState(false)
  const [pendingArchive, setPendingArchive] = useState<SupportMarkAutomationRule | null>(null)

  /*
    **遅い返事を別のマークへ映さない。**
    アカウントとマークと世代の3つが一致したときだけ受け取る。
    マークを続けて押すと、前の返事があとから届くことがある。
  */
  const requestRef = useRef<RequestAt>({ accountId: null, markId: null, generation: 0 })

  const load = useCallback(async () => {
    if (!accountId || !markId) return
    requestRef.current = {
      accountId, markId, generation: requestRef.current.generation + 1,
    }
    const at: RequestAt = { ...requestRef.current }
    const stillHere = () => isCurrentResponse(requestRef.current, at)

    setState('loading')
    try {
      const res = await api.supportMarks.automationRules(markId, accountId)
      if (!stillHere()) return
      if (!res.success) throw new Error('failed')
      setRules(inExecutionOrder(res.data))
      setState('ready')
    } catch (err) {
      if (!stillHere()) return
      /*
        権限不足・未接続・取得失敗を分ける。**次にすることが違う。**
        権限なら人に頼む、未接続なら待つ、取得失敗ならもう一度試す。

        **404 を「取得失敗」に混ぜない。** 混ぜると「読み直す」を出すことに
        なり、何度押しても直らない口を押させ続ける。この画面が呼ぶ口は
        まだ Worker に無く（API は skmtmst/line-harness-oss#758）、
        入るまでは 404 が返る。
      */
      if (!(err instanceof ApiError)) { setState('error'); return }
      if (err.status === 403) { setState('forbidden'); return }
      setState(err.status === 404 ? 'not-connected' : 'error')
    }
  }, [accountId, markId])

  /*
    **開いたときに読むだけ。** 保存や削除の口は呼ばない。
    以前ほかの画面で、開いただけで試験送信が走り、公開の条件を
    満たしてしまったことがある。
  */
  useEffect(() => {
    /* アカウントやマークが変わったら、前の内容と結果をその場で捨てる。 */
    setRules([])
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFailure(null)
    setTouched(false)
    setPendingArchive(null)
    if (!accountId || !markId) {
      requestRef.current = { accountId, markId, generation: requestRef.current.generation + 1 }
      setState('ready')
      return
    }
    void load()
  }, [accountId, markId, load])

  if (!markId) {
    return (
      <ListState
        kind="empty"
        title="マークを選んでください"
        description="左の一覧から選ぶと、そのマークの自動変更ルールを確認・保存できます。"
      />
    )
  }

  const errors = validateRule({
    name: draft.name,
    priority: Number(draft.priority),
    manualProtectionMinutes: Number(draft.manualProtectionMinutes),
  })
  const errorFor = (field: 'name' | 'priority' | 'manualProtectionMinutes') =>
    touched ? errors.find((e) => e.field === field)?.message : undefined

  const openNew = () => {
    setEditingId('new')
    setDraft(EMPTY_DRAFT)
    setFailure(null)
    setTouched(false)
  }

  const openEdit = (rule: SupportMarkAutomationRule) => {
    setEditingId(rule.id)
    setDraft(draftOf(rule))
    setFailure(null)
    setTouched(false)
  }

  const save = async () => {
    if (!accountId || !markId || errors.length > 0) return
    const call = saveCallOf(editingId, rules)
    if (!call) return
    const body = toRuleBody(draft)
    setSaving(true)
    setFailure(null)
    try {
      const res = call.kind === 'update'
        ? await api.supportMarks.updateAutomationRule(call.ruleId, accountId, call.expectedVersion, body)
        : await api.supportMarks.createAutomationRule(markId, accountId, body)
      if (!res.success) throw new Error('failed')
      setEditingId(null)
      await load()
    } catch (err) {
      /*
        **版競合では窓を閉じない。** 閉じると、直した内容が消えたのか
        保存できたのか分からなくなる。書いた内容は残したまま断る。
      */
      setFailure(failureOf({ status: err instanceof ApiError ? err.status : undefined }))
    } finally {
      setSaving(false)
    }
  }

  const archive = async () => {
    if (!accountId || !pendingArchive) return
    setSaving(true)
    setFailure(null)
    try {
      const res = await api.supportMarks.archiveAutomationRule(
        pendingArchive.id, accountId, pendingArchive.version,
      )
      if (!res.success) throw new Error('failed')
      setPendingArchive(null)
      await load()
    } catch (err) {
      setFailure(failureOf({ status: err instanceof ApiError ? err.status : undefined }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.panel} data-design-node="GMvBd">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h3 className={styles.title}>自動変更ルール</h3>
          <p className={styles.note}>
            受信・返信・担当割当・期限超過などをきっかけに、「{markName}」へ自動で変えられます。
          </p>
        </div>
        <Button
          variant="primary"
          data-qa-open="GMvBd"
          onClick={openNew}
          disabled={state === 'forbidden' || state === 'not-connected'}
        >
          ルールを追加
        </Button>
      </header>

      {failure ? (
        <div
          className={failure.kind === 'forbidden' ? styles.notice : styles.warn}
          role="alert"
          data-failure-kind={failure.kind}
        >
          <p>{failure.message}</p>
          {failure.canReload ? (
            <Button onClick={() => void load()}>最新の内容を読み直す</Button>
          ) : null}
        </div>
      ) : null}

      {state === 'loading' ? (
        <ListState kind="loading" title="自動変更ルールを読み込んでいます" />
      ) : state === 'forbidden' ? (
        <ListState
          kind="forbidden"
          title="自動変更ルールを見る権限がありません"
          description="このLINEアカウントの自動変更ルールは、管理者だけが扱えます。"
        />
      ) : state === 'not-connected' ? (
        /*
          **押しても何も起きない操作を並べない**（`v6-common-rules` §5-5）。
          読み直しの口も出さない——押しても直らないため。
        */
        <ListState
          kind="empty"
          title="自動変更ルールはまだ接続されていません"
          description="ルールを保存する仕組みが、このアカウントではまだ動いていません。接続されるとここに一覧が出ます。それまでは対応マークを手で変えてください。"
        />
      ) : state === 'error' ? (
        <ListState
          kind="error"
          title={LIST_ERROR.title}
          description={LIST_ERROR.description}
          action={<Button onClick={() => void load()}>自動変更ルールを読み直す</Button>}
        />
      ) : rules.length === 0 && editingId === null ? (
        <ListState kind="empty" title={LIST_EMPTY.title} description={LIST_EMPTY.description} />
      ) : (
        <>
          {/* 実行順そのものを並びにしている。上のほうが先に効く。 */}
          <p className={styles.note}>{MULTI_MATCH_NOTE}</p>
          <ol className={styles.list}>
            {rules.map((rule, index) => (
              <li key={rule.id} className={styles.row}>
                <span className={styles.rank}>{index + 1}</span>
                <div className={styles.rowBody}>
                  <p className={styles.rowName}>{rule.name}</p>
                  <p className={styles.rowMeta}>
                    {eventLabel(rule.event)}
                    <span className={styles.dot}>・</span>
                    優先順位 {rule.priority}
                    <span className={styles.dot}>・</span>
                    手動変更のあと {protectionText(rule.manualProtectionMinutes)}
                  </p>
                </div>
                <span className={rule.isActive ? styles.on : styles.off}>{activeText(rule.isActive)}</span>
                <span className={styles.rowActions}>
                  <Button onClick={() => openEdit(rule)}>変更</Button>
                  <Button onClick={() => { setFailure(null); setPendingArchive(rule) }}>停止する</Button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {editingId !== null ? (
        <div className={styles.form}>
          <h4 className={styles.formTitle}>{editingId === 'new' ? 'ルールを追加' : 'ルールを変更'}</h4>
          <label className={styles.field}>
            <span className={styles.label}>ルールの名前</span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="例: 担当者が決まったら対応中へ"
            />
            {errorFor('name') ? <span className={styles.fieldError}>{errorFor('name')}</span> : null}
          </label>

          <fieldset className={styles.field}>
            <legend className={styles.label}>きっかけ</legend>
            <div className={styles.events}>
              {EVENT_LABELS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.event === item.value}
                  onClick={() => setDraft((d) => ({ ...d, event: item.value }))}
                  className={draft.event === item.value ? styles.eventOn : styles.event}
                >
                  <span className={styles.eventLabel}>{item.label}</span>
                  <span className={styles.eventNote}>{item.note}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.label}>優先順位</span>
              <input
                className={styles.input}
                type="number"
                min={PRIORITY_MIN}
                max={PRIORITY_MAX}
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
              />
              <span className={styles.hint}>大きいほど先に見ます。</span>
              {errorFor('priority') ? <span className={styles.fieldError}>{errorFor('priority')}</span> : null}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>手動変更のあと自動で変えない時間（分）</span>
              <input
                className={styles.input}
                type="number"
                min={0}
                max={PROTECTION_MAX}
                value={draft.manualProtectionMinutes}
                onChange={(e) => setDraft((d) => ({ ...d, manualProtectionMinutes: e.target.value }))}
              />
              {/* 0のときに「0なら保護しません。保護しない」と重ねて言わない。 */}
              <span className={styles.hint}>
                {Number(draft.manualProtectionMinutes) === 0
                  ? '0なら、手で変えたあとでも自動で変わります。'
                  : `手で変えたあと ${protectionText(Number(draft.manualProtectionMinutes))} は自動で変わりません。`}
              </span>
              {errorFor('manualProtectionMinutes')
                ? <span className={styles.fieldError}>{errorFor('manualProtectionMinutes')}</span>
                : null}
            </label>
          </div>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
            />
            このルールを動かす
          </label>

          <div className={styles.formActions}>
            <Button onClick={() => { setEditingId(null); setFailure(null) }} disabled={saving}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              /* 撮影の目印。文言で探すと、ほかの「保存」に当たって空振りする。 */
              data-qa-open="GMvBd-save"
              onMouseDown={() => setTouched(true)}
              onClick={() => void save()}
              disabled={saving || errors.length > 0}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingArchive !== null}
        title="このルールを停止しますか？"
        /* 消去ではない。履歴が残ることを先に言う。 */
        description={
          `「${pendingArchive?.name ?? ''}」を停止します。`
          + 'これ以降このルールでマークは変わりません。'
          + 'これまでの変更履歴は監査記録として残ります。'
        }
        confirmLabel="このルールを停止"
        destructive
        busy={saving}
        onConfirm={() => void archive()}
        onCancel={() => { if (!saving) setPendingArchive(null) }}
      />
    </section>
  )
}
