'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoLineKind, AutoLineRule } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { RowMenu } from '@/components/shared/row-actions'
import StatusBadge from '@/components/shared/status-badge'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Toggle from '@/components/shared/toggle'
import { notifySaved, notifyToast } from '@/components/shared/toast'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { ecAutoLineApi } from '@/lib/api/helpers/gap3'
import { formatNumber } from '@/lib/format'
import EditDrawer from './edit-drawer'
import { KIND_LABEL, KIND_ORDER, KIND_WHEN, KIND_WHO, failureText, waitLabel } from './words'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import styles from './auto-line.module.css'

/*
 * ★V8 EC連携「自動の LINE」（G6-1 `TSRlY`）。カゴ落ち・閲覧落ち・再入荷の3行の表。
 * 受け口は試験運転だけ（testMode）：オンにしても LINE へは送らず、送る予定を記録する。
 * クリック・購入・金額は計測がまだつながっていないので「—」。計測の入れ方は、口ができるまで共通の「まだ使えない」窓で知らせる。
 * 閲覧のみの人には、オン・オフのスイッチも「…」も置かない（状態は札で見せる）。
 */

type Status = 'loading' | 'ready' | 'error'
type Counts = Partial<Record<AutoLineKind, number>>

export default function EcAutoLine({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const preparing = usePreparingDialog()
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<unknown>(null)
  const [rules, setRules] = useState<AutoLineRule[]>([])
  const [counts, setCounts] = useState<Counts>({})
  const [notice, setNotice] = useState('')
  const [confirmKind, setConfirmKind] = useState<AutoLineKind | null>(null)
  const [busyKind, setBusyKind] = useState<AutoLineKind | null>(null)
  const [editKind, setEditKind] = useState<AutoLineKind | null>(null)
  const [menuKind, setMenuKind] = useState<AutoLineKind | null>(null)
  const current = useRef<string | null>(null)
  const errors = useSaveFormErrors()

  const load = useCallback(async () => {
    if (!accountId) return
    current.current = accountId
    setStatus('loading')
    try {
      const response = await ecAutoLineApi.rules(accountId)
      if (!response.success) throw new Error('rules_failed')
      if (current.current !== accountId) return
      setRules(response.data)
      setStatus('ready')
      /* 送った数（試験運転で記録した件数）。取れなかった種類は「—」のまま。 */
      const sent = await Promise.allSettled(KIND_ORDER.map((kind) => ecAutoLineApi.sends(accountId, kind, 'simulated', 0)))
      if (current.current !== accountId) return
      const next: Counts = {}
      sent.forEach((item, index) => {
        if (item.status === 'fulfilled' && item.value.success) next[KIND_ORDER[index]] = item.value.data.total
      })
      setCounts(next)
    } catch (reason) {
      if (current.current !== accountId) return
      setError(reason)
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const ruleOf = (kind: AutoLineKind) => rules.find((rule) => rule.kind === kind)

  const turnOff = async (rule: AutoLineRule) => {
    if (!accountId) return
    setBusyKind(rule.kind)
    setNotice('')
    try {
      const response = await ecAutoLineApi.save(accountId, rule.kind, { waitMinutes: rule.waitMinutes, messages: rule.messages, expectedVersion: rule.version, enabled: false })
      if (!response.success) throw new Error('save_failed')
      notifySaved(`${KIND_LABEL[rule.kind]}の自動の LINE をオフにしました。`)
      await load()
    } catch (reason) {
      if (!errors.capture(reason)) setNotice(failureText(reason, 'オフにする'))
      await load()
    } finally {
      setBusyKind(null)
    }
  }

  const turnOn = async (kind: AutoLineKind) => {
    const rule = ruleOf(kind)
    if (!accountId || !rule) return
    setBusyKind(kind)
    setNotice('')
    try {
      const response = await ecAutoLineApi.enableMock(accountId, kind, rule.version, crypto.randomUUID())
      if (!response.success) throw new Error('enable_failed')
      setConfirmKind(null)
      notifySaved(`${KIND_LABEL[kind]}の自動の LINE をオンにしました（試験運転）。`)
      await load()
    } catch (reason) {
      setConfirmKind(null)
      if (!errors.capture(reason)) setNotice(failureText(reason, 'オンにする'))
      await load()
    } finally {
      setBusyKind(null)
    }
  }

  const testRule = async (kind: AutoLineKind) => {
    if (!accountId) return
    try {
      const response = await ecAutoLineApi.test(accountId, kind)
      if (!response.success) throw new Error('test_failed')
      notifyToast(`${KIND_LABEL[kind]}の見本を作りました。LINE へは送っていません。`)
    } catch (reason) {
      if (!errors.capture(reason)) setNotice(failureText(reason, '見本を作る'))
    }
  }

  if (!accountId) return <ListState kind="empty" emptyPreset="readonly" title="LINEアカウントを選んでください" description="共通メニューで、自動の LINE を設定するアカウントを選んでください。" />
  if (status === 'loading' && rules.length === 0) return <ListState kind="loading" title="自動の LINE を読み込んでいます" />
  if (status === 'error') return <ListState kind="error" error={error} onRetry={() => void load()} />

  return (
    <SaveErrorScope errors={errors}><section className={styles.panel} aria-label="自動の LINE">
      <Notice
        tone="warn"
        message="閲覧落ち・カゴ落ちには、お店のサイトに musubo の計測の読み込みが要ります。今は試験運転で、LINE へは送りません。"
        action={<Button variant="secondary" onClick={() => preparing.open('計測の入れ方')}>入れ方を見る</Button>}
      />
      {notice ? <Notice tone="danger" message={notice} /> : null}
      <div className={styles.head}>
        <h3 className={styles.headTitle}>自動の LINE</h3>
        <HelpTip label="自動の LINE の説明">お店のサイトでの動き（カートに入れた・商品を見た・入荷待ちにした）に合わせて、あとから自動で LINE を送る仕組みです。宣伝を止めている人・ブロックした人には送りません。1 人に送るのは 1 日 1 通・1 週間に 3 通までです。</HelpTip>
        <span className={styles.headNote}>試験運転・実際に送った 0 件</span>
      </div>
      <DataTable>
        <thead>
          <TableHeadRow>
            <Th grow>種類</Th>
            <Th>オン</Th>
            <Th>待つ時間</Th>
            <Th align="right" help="試験運転で「送る予定」として記録した件数です。LINE へは送っていません。">送った</Th>
            <Th align="right">クリック</Th>
            <Th align="right">購入</Th>
            <Th align="right">金額</Th>
            <Th>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {KIND_ORDER.map((kind) => {
            const rule = ruleOf(kind)
            if (!rule) return null
            const sentCount = counts[kind]
            return (
              <Tr key={kind} data-row-id={kind}>
                <Td grow>
                  <span className={styles.kindCell} title={KIND_WHO[kind]}>
                    <span className={styles.kindName}>{KIND_LABEL[kind]}</span>
                  </span>
                </Td>
                <Td>
                  {canEdit ? (
                    <Toggle
                      label={`${KIND_LABEL[kind]}の自動の LINE`}
                      checked={rule.enabled}
                      disabled={busyKind === kind}
                      onChange={(next) => { if (next) setConfirmKind(kind); else void turnOff(rule) }}
                    />
                  ) : (
                    <StatusBadge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'オン' : 'オフ'}</StatusBadge>
                  )}
                </Td>
                <Td>{waitLabel(rule.waitMinutes)}</Td>
                <Td align="right">{sentCount === undefined ? <span className={styles.unavailableValue}>—</span> : `${formatNumber(sentCount)} 件`}</Td>
                <Td align="right"><span className={styles.unavailableValue} title="クリックの計測はまだつながっていません">—</span></Td>
                <Td align="right"><span className={styles.unavailableValue} title="購入の計測はまだつながっていません">—</span></Td>
                <Td align="right"><span className={styles.unavailableValue} title="金額の計測はまだつながっていません">—</span></Td>
                <ActionCell>
                  {canEdit ? (
                    <span className={styles.menuBox}>
                      <RowMenu
                        label={`${KIND_LABEL[kind]}の操作`}
                        open={menuKind === kind}
                        onOpenChange={(next) => setMenuKind(next ? kind : null)}
                        items={[
                          { id: 'edit', label: '編集する', onSelect: () => setEditKind(kind) },
                          { id: 'test', label: 'テストを見る', onSelect: () => void testRule(kind) },
                        ]}
                      />
                    </span>
                  ) : null}
                </ActionCell>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
      <p className={styles.foot}>1 人に送るのは 1 日 1 通・1 週間に 3 通まで。配信を止めている人には送りません。</p>

      <ConfirmDialog
        open={confirmKind !== null}
        title={confirmKind ? `${KIND_LABEL[confirmKind]}の自動の LINE をオンにしますか？` : ''}
        description={confirmKind ? `これから ${KIND_WHEN[confirmKind]} に自動で送る準備をします。宣伝を止めている人には送りません。今は試験運転で、LINE へは送らず、送る予定だけを記録します。` : ''}
        confirmLabel="オンにする"
        busy={busyKind !== null && busyKind === confirmKind}
        onConfirm={() => { if (confirmKind) void turnOn(confirmKind) }}
        onCancel={() => setConfirmKind(null)}
      />
      <EditDrawer
        accountId={accountId}
        rule={editKind ? ruleOf(editKind) ?? null : null}
        onClose={() => setEditKind(null)}
        onSaved={async () => { setEditKind(null); await load() }}
      />
      {preparing.dialog}
    </section></SaveErrorScope>
  )
}
