'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Circle } from 'lucide-react'
import { api, describeSaveFailure, type SaveSupportMarkAutomationRule, type SupportMarkAutomationEvent, type SupportMarkListItem } from '@/lib/api'
import { useCanManageSupportMark } from './support-mark-permissions'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Checkbox from '@/components/shared/checkbox'
import Card from '@/components/shared/card'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import SupportMarkRulesPanel from './support-mark-rules-panel'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import Notice from '@/components/shared/notice'
import { EVENT_LABELS, eventLabel } from './support-mark-rules-view'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from './attribute-kind-guide'

const COLORS = [
  { value: '#EF4B55', name: '赤' },
  { value: '#B86A00', name: 'オレンジ' },
  { value: '#06C755', name: '緑' },
  { value: '#2563D4', name: '青' },
  { value: '#6B56CF', name: '紫' },
  { value: '#707981', name: 'グレー' },
] as const
const DESTINATIONS = ['受信箱の絞り込み', '友だち一覧の列と絞り込み', 'ダッシュボードの絞り込み', '配信の絞り込み条件', 'オートメーションの動作']
type MarkRow = SupportMarkListItem

export default function SupportMarkEditor({ markId }: { markId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const editing = Boolean(markId)
  usePageTitle(editing ? '対応マークを編集' : '対応マークを作る')

  const [items, setItems] = useState<MarkRow[]>([])
  /*
   * R510・R511: 一覧の読み込み具合。`ready` になるまで保存は押せない。
   * `error` は再読み込みで続けられ、`forbidden` は権限が無いので
   * 作成・編集の案内自体を出さない（フォルダ作成画面と同じ約束）。
   */
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [loadMessage, setLoadMessage] = useState('')
  /** 再読み込みの最中。再試行ボタンの二度押しを止める（入力欄は隠さない）。 */
  const [reloading, setReloading] = useState(false)
  const [name, setName] = useState('要確認')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [displayOrder, setDisplayOrder] = useState(4)
  const [isDefault, setIsDefault] = useState(false)
  /*
    ATTR-06: 自動変更ルールは「作るだけで有効」にしない。
    以前は初期値が true で、追加ボタンを押さなくても保存時に
    isActive=true のルールと保護時間0分が黙って送られていた。
    利用者が「＋ ルールを作る」を押したときだけ登録し、
    外す・無効化する操作を同じ場所に置く。
  */
  const [createRule, setCreateRule] = useState(false)
  const [ruleEvent, setRuleEvent] = useState<SupportMarkAutomationEvent>('staff_assigned')
  const [ruleActive, setRuleActive] = useState(true)
  const [ruleProtectionMinutes, setRuleProtectionMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /*
   * R511: 保存で権限不足（403）が返ってきた。以後は押させず、
   * 理由だけを見せる。入力内容は残す（直して再送できる場合に備える）。
   */
  const [saveForbidden, setSaveForbidden] = useState(false)
  /*
   * R512: 同じ作成のやり直しは同じ要求キーで送る。入力を変えたら
   * 新しいキーにする（同じキーに異なる内容はサーバが409で止める）。
   * キーは保存の直前に内容と比べて決める。useEffect での作り直しは
   * 描画の後追いになり、一覧の読み直し直後の再送と行き違いで
   * キーが替わることがあるため、ここでは使わない。
   */
  const idempotencyKeyRef = useRef<{ signature: string; key: string } | null>(null)
  const attemptSignature = JSON.stringify([
    name, color, displayOrder, isDefault,
    createRule, ruleEvent, ruleActive, ruleProtectionMinutes,
  ])
  function attemptKey(): string {
    const current = idempotencyKeyRef.current
    if (current && current.signature === attemptSignature) return current.key
    const key = crypto.randomUUID()
    idempotencyKeyRef.current = { signature: attemptSignature, key }
    return key
  }
  /*
   * R513: ほかの担当者が先に変えていたときの最新の内容。
   * 入力は残したまま、最新の名前・色・並び順と版を見せて選ばせる。
   */
  const [conflict, setConflict] = useState<{
    name: string
    color: string
    displayOrder: number
    version: number
  } | null>(null)
  /*
   * R176 監査：名前・色を変えたまま一覧へ移ると、確認なく入力が消える。
   * 読み込んだ（新規は作りたての）姿との差を未保存とし、離れる操作では
   * 確認を出す。保存の成功後は別画面へ送るため、確認が出ることはない。
   */
  const [baseline, setBaseline] = useState<{ name: string; color: string; displayOrder: number; isDefault: boolean } | null>(null)
  const selected = useMemo(() => items.find((mark) => mark.id === markId), [items, markId])
  const dirty = baseline !== null && (
    name !== baseline.name
    || color !== baseline.color
    || displayOrder !== baseline.displayOrder
    || isDefault !== baseline.isDefault
    // 新規の自動変更ルールは「作る」と押した時点で書きかけ。
    || (!editing && (createRule || ruleEvent !== 'staff_assigned' || ruleActive !== true || ruleProtectionMinutes !== 0))
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  /* IDEA-04: 同名のマークがすでにあるとき、保存する前に知らせる（自分自身は外す）。 */
  const nameDuplicates = useMemo(() => findDuplicateNames(items, name, markId ?? null), [items, name, markId])
  const currentUsages = selected ? [
    selected.friendCount > 0 ? `友だち ${selected.friendCount}人` : null,
    selected.usedIn?.broadcasts ? `配信 ${selected.usedIn.broadcasts}件` : null,
    selected.usedIn?.scenarios ? `シナリオ ${selected.usedIn.scenarios}件` : null,
    selected.usedIn?.autoReplies ? `自動応答 ${selected.usedIn.autoReplies}件` : null,
    selected.usedIn?.savedSearches ? `保存した検索 ${selected.usedIn.savedSearches}件` : null,
    selected.usedIn?.automations ? `オートメーション ${selected.usedIn.automations}件` : null,
  ].filter((value): value is string => Boolean(value)) : []

  /*
   * R511: 役割が分かっているstaffには作成・編集を案内しない。
   * 役割がまだ読めていない間は案内を出したままにし（表示の目安）、
   * 本当の可否はサーバが決める。403が返ってきたら保存時に止める。
   */
  const canManageByRole = useCanManageSupportMark()
  const roleBlocked = canManageByRole === false
  /*
   * R510: 初回の読み込みだけ入力欄を埋める。再読み込みでは入力内容を
   * 失わない（一覧と重複の注意だけを新しくする）。アカウントや対象が
   * 変わったら次の読み込みで埋め直す。
   */
  const initialLoadRef = useRef(true)
  const load = useCallback(async () => {
    const account = selectedAccountId
    if (!account) {
      setItems([])
      setLoadMessage('LINE公式アカウントを選んでください')
      setLoadState('error')
      return
    }
    setReloading(true)
    setLoadMessage('')
    try {
      const res = await api.supportMarks.list(account)
      if (!res.success) throw new Error(res.error)
      const rows = res.data
      setItems(rows)
      const current = rows.find((mark) => mark.id === markId)
      if (current) {
        if (initialLoadRef.current) {
          setName(current.name)
          setColor(current.color)
          setDisplayOrder(current.displayOrder)
          setIsDefault(current.isDefault)
        }
        setBaseline({ name: current.name, color: current.color, displayOrder: current.displayOrder, isDefault: current.isDefault })
        setLoadState('ready')
      } else if (editing) {
        setLoadMessage('対応マークが見つかりません。一覧から選び直してください。')
        setLoadState('error')
      } else if (initialLoadRef.current) {
        // 新規は作りたての姿（名前「要確認」・先頭の色・末尾の順番）を
        // 「保存済み」とし、触った分だけ未保存にする。
        setDisplayOrder(rows.length)
        setBaseline({ name: '要確認', color: COLORS[0].value, displayOrder: rows.length, isDefault: false })
        setLoadState('ready')
      } else {
        setLoadState('ready')
      }
    } catch (reason) {
      const status = (reason as { status?: number } | null)?.status
      if (status === 403) {
        setLoadMessage('')
        setLoadState('forbidden')
      } else {
        setLoadMessage('対応マークを読み込めませんでした。入力内容はそのままです。')
        setLoadState('error')
      }
    } finally {
      initialLoadRef.current = false
      setReloading(false)
    }
  }, [editing, markId, selectedAccountId])

  useEffect(() => {
    initialLoadRef.current = true
    setBaseline(null)
    setConflict(null)
    setSaveForbidden(false)
    void load()
  }, [editing, markId, selectedAccountId, load])

  const save = async () => {
    if (!name.trim()) return setError('マーク名を入力してください')
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    // R510: 一覧を読めていない間の保存は送らない（重複の注意も出せないため）。
    if (loadState !== 'ready' || roleBlocked || saveForbidden) return
    setSaving(true)
    setError('')
    setConflict(null)
    try {
      const result = editing && markId
        ? await api.supportMarks.update(markId, selectedAccountId, {
            name: name.trim(), color, displayOrder, isDefault,
            autoOnInbound: selected?.autoOnInbound ?? false,
            // R513: 読んだときの版を送り、ほかの担当者が先に変えていたら409で止める。
            ...(selected ? { expectedVersion: selected.version } : {}),
          })
        : await api.supportMarks.create(selectedAccountId, {
            name: name.trim(), color, displayOrder, isDefault, autoOnInbound: false,
            automationRules: createRule ? [{ name: `${name.trim()}：${eventLabel(ruleEvent)}`, event: ruleEvent, condition: null, priority: 0, manualProtectionMinutes: ruleProtectionMinutes, isActive: ruleActive } satisfies SaveSupportMarkAutomationRule] : [],
          }, attemptKey())
      if (!result.success) throw new Error(result.error)
      router.push('/tags?tab=marks')
    } catch (reason) {
      const status = (reason as { status?: number } | null)?.status
      const code = (reason as { code?: string } | null)?.code
      if (status === 403) {
        // R511: 権限不足は通信の失敗と分けて伝え、以後は押させない。
        setSaveForbidden(true)
        setError(describeSaveFailure(reason))
        return
      }
      if (status === 409 && code === 'SUPPORT_MARK_VERSION_CONFLICT') {
        // R513: 最新の内容を見せて、入力を残したまま選ばせる。
        const latest = (reason as { data?: { latest?: {
          name?: string; color?: string; displayOrder?: number; version?: number; isDefault?: boolean;
        } } }).data?.latest
        if (latest && typeof latest.name === 'string') {
          const next = {
            name: latest.name,
            color: typeof latest.color === 'string' ? latest.color : color,
            displayOrder: typeof latest.displayOrder === 'number' ? latest.displayOrder : displayOrder,
            version: typeof latest.version === 'number' ? latest.version : (selected?.version ?? 1),
          }
          setConflict(next)
          // 最新の版へ進め、入力は残す。保存し直すと新しい版で送られる。
          setItems((prev) => prev.map((mark) => mark.id === markId
            ? { ...mark, name: next.name, color: next.color, displayOrder: next.displayOrder, version: next.version }
            : mark))
          setBaseline({ name: next.name, color: next.color, displayOrder: next.displayOrder, isDefault: selected?.isDefault ?? isDefault })
        }
        setError('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
        return
      }
      setError(describeSaveFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  /*
   * 保存を止めている理由。押せないだけにせず、本文に出す
   * （フォルダ作成画面と同じ約束）。
   */
  const blockedReason =
    loadState === 'error' ? '一覧を読み込めませんでした。再読み込みしてください'
      : loadState === 'forbidden' ? '対応マークを見る権限がありません'
        : roleBlocked ? '対応マークを作る権限がありません'
          : saveForbidden ? '対応マークを保存する権限がありません'
            : !name.trim() ? 'マーク名を入力すると保存できます'
              : editing && !selected ? '編集中のマークを読み込めませんでした'
                : null
  const saveDisabled = saving || blockedReason !== null
  // R511: 権限が無いときは作成・編集の案内を出さない（一覧の403か役割のstaff）。
  const hideForm = loadState === 'forbidden' || roleBlocked
  /*
   * R513: 最新の内容を入力へ取り込む。取り込んだ分は未保存になるので、
   * そのまま保存し直すと最新の版で送られる。
   */
  const applyLatest = () => {
    if (!conflict) return
    setName(conflict.name)
    setColor(conflict.color)
    setDisplayOrder(conflict.displayOrder)
    setConflict(null)
  }

  if (loadState === 'loading') return <ListState kind="loading" />

  return (
    <div data-design-node="GMvBd">
      {/* m22c: 見出し行の戻りは共通の行き先リンク（カード見出しと同じ13px/600青文字）。ボタン枠のままでは分類案内の行き先リンクとずれる（自動点検 k=10）。 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '対応マーク', href: '/tags?tab=marks' }, { label: editing ? 'マークを編集' : 'マークを作る' }]} />
        <Link href="/tags?tab=marks" className="text-status-info shrink-0 text-label font-semibold hover:underline">対応マークへ</Link>
      </div>

      {/*
        R511: 権限が無いときは作成・編集の案内自体を出さない。
        R510: 読み込み失敗はその場に再試行を置き、入力欄は残す。
      */}
      {hideForm ? (
        <ListState
          kind="forbidden"
          description={editing
            ? '対応マークを編集する権限がありません。オーナーか管理者に確認してください。'
            : '対応マークを作る権限がありません。オーナーか管理者に確認してください。'}
        />
      ) : null}
      {!hideForm && loadState === 'error' ? (
        <div className="mb-4">
          <ListState
            kind="error"
            title="対応マークを読み込めませんでした"
            description={loadMessage || '入力内容はそのままです。'}
            onRetry={() => void load()}
            retrying={reloading}
          />
        </div>
      ) : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
      {conflict ? (
        <Notice
          tone="warn"
          className="mb-4"
          action={<Button type="button" onClick={applyLatest}>最新の内容を取り込む</Button>}
        >
          最新の保存内容は名前「{conflict.name}」・並び順{conflict.displayOrder}です。
          入力内容はそのまま残しています。入力のまま保存し直すか、最新の内容を取り込んでください。
        </Notice>
      ) : null}

      {hideForm ? null : (
      <>
      {/*
        グリッド子は `min-w-0` で縮める（#973 U020）。無いと中身の
        最小幅がそのまま段の最小幅になり、狭い幅でカードの右端が切れる。
      */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card padding="default" className="min-w-0">
          <h2 className="mb-4 text-sm font-bold text-ink">基本情報</h2>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">マーク名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-control border border-hairline px-3 text-sm" placeholder="例：要確認" />
            <DuplicateNameNote duplicates={nameDuplicates} kindLabel="対応マーク" />
          </label>
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-semibold text-ink-secondary">色</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((item) => <button key={item.value} type="button" onClick={() => setColor(item.value)} aria-label={item.name} title={item.name} aria-pressed={color === item.value} className={`h-8 w-8 rounded-pill ${color === item.value ? 'ring-2 ring-ink ring-offset-2' : ''}`} style={{ backgroundColor: item.value }} />)}
            </div>
          </fieldset>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">並び順</span>
            <input type="number" min={0} value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} className="h-10 w-28 rounded-control border border-hairline px-3 text-sm" />
          </label>
          {/*
            説明文とチェックは別行にする（#973 U020）。1行に押し込むと
            狭い幅でチェック欄がカードの外へ切れる。
          */}
          <div className="border-t border-hairline pt-4">
            <Checkbox
              checked={isDefault}
              disabled={selected?.isDefault}
              onCheckedChange={setIsDefault}
            >新しい友だちに最初から付ける</Checkbox>
            <p className="mt-1 text-xs font-normal leading-relaxed text-ink-faint">最初から付けるマークは1つだけ選べます</p>
          </div>
          {/* IDEA-04: 対応の状態管理なら対応マーク・印だけならタグ・値を持たせるなら情報欄という違いを、作る場所で確認できるようにする。 */}
          <div className="mt-4"><AttributeKindGuide current="mark" /></div>
        </Card>

        {/* 設計 GMvBd は基本情報と自動変更を横並びで比較できる。 */}
        {editing ? (
          <Card padding="default" className="min-w-0">
            <SupportMarkRulesPanel accountId={selectedAccountId} markId={markId ?? null} markName={name} />
          </Card>
        ) : (
          <Card padding="default" className="min-w-0">
            <h2 className="mb-2 text-sm font-bold text-ink">自動変更ルール</h2>
            <p className="text-xs leading-relaxed text-ink-faint">受信・返信・担当割当・期限超過などをきっかけに自動変更できます。</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink-secondary">このマークを作るときに登録するルール</p>
              {createRule ? null : <Button type="button" onClick={() => setCreateRule(true)}>＋ ルールを作る</Button>}
            </div>
            {createRule ? (
              /*
                きっかけと変更先は縦に並べる（#973 U021）。横並びだと
                狭い幅で選択肢も変更先も切れる。矢印は向きを示す飾り。
                追加したあとは外せる。保存前に、いつ・何へ・どう守るかを
                このカードで確認する（ATTR-06）。
              */
              <div className="mt-3 rounded-control border border-hairline p-3 text-sm">
                <label className="block text-xs font-semibold text-ink-secondary">
                  きっかけ
                  <Select
                    aria-label="きっかけ"
                    value={ruleEvent}
                    onChange={(value) => setRuleEvent(value as SupportMarkAutomationEvent)}
                    options={EVENT_LABELS.map((item) => ({ value: item.value, label: item.label }))}
                    size="full"
                    className="mt-1"
                  />
                </label>
                <p aria-hidden="true" className="my-1 text-center text-ink-faint">↓</p>
                <p className="min-w-0 break-words rounded-control bg-surface-soft px-3 py-2.5 font-semibold text-ink">「{name || 'このマーク'}」に変更</p>
                <label className="mt-3 block text-xs font-semibold text-ink-secondary">
                  手動で変更した直後の保護
                  <Select
                    aria-label="手動変更の保護時間"
                    value={String(ruleProtectionMinutes)}
                    onChange={(value) => setRuleProtectionMinutes(Number(value))}
                    options={[
                      { value: '0', label: '保護しない（次のきっかけですぐ変更）' },
                      { value: '30', label: '30分は手動の変更を守る' },
                      { value: '60', label: '1時間は手動の変更を守る' },
                      { value: '1440', label: '1日は手動の変更を守る' },
                    ]}
                    size="full"
                    className="mt-1"
                  />
                </label>
                <Checkbox
                  checked={ruleActive}
                  onCheckedChange={setRuleActive}
                  className="mt-3"
                >このルールを有効にして登録する</Checkbox>
                <div className="mt-3 flex justify-end">
                  <Button type="button" onClick={() => setCreateRule(false)}>ルールを外す</Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">今は自動変更しません。必要なときだけルールを追加してください。</p>
            )}
          </Card>
        )}

        <Card padding="default" className="min-w-0">
          <h2 className="mb-3 text-sm font-bold text-ink">どこで使われるか</h2>
          <ul className="space-y-2 text-xs text-ink">
            {DESTINATIONS.map((label) => <li key={label} className="flex items-start gap-2"><Circle size={6} fill="currentColor" className="mt-1 shrink-0 text-ink-faint" aria-hidden="true" /><span>{label}</span></li>)}
          </ul>
          {!editing ? <p className="mt-4 text-xs leading-relaxed text-ink-faint">受信箱・友だち一覧・友だち詳細のすべてに同じ順番で表示します。</p> : null}
          {editing && currentUsages.length > 0 ? <p className="mt-4 text-xs font-semibold text-ink-secondary">現在の使用先：{currentUsages.join('、')}</p> : null}
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">配信などの使用先がある間は保管できません。使用先を外すと、友だちは最初から付けるマークへ移り、変更履歴は残ります。</p>
        </Card>
      </div>

      <StickyBar
        className="mt-4"
        status={blockedReason ?? (editing ? '変更内容を確認して保存してください' : 'マーク名・色・初期値を確認してください')}
        actions={<><Button href="/tags?tab=marks">キャンセル</Button><Button type="button" variant="primary" disabled={saveDisabled} onClick={() => void save()}>{saving ? '保存中…' : editing ? '保存する' : '対応マークを作る'}</Button></>}
      />
      </>
      )}
      {/* R176 監査：名前・色などの書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="マークへの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
