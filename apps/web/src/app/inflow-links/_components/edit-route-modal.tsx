'use client'

import { useEffect, useState } from 'react'
import Combobox from '@/components/shared/combobox'
import Select from '@/components/shared/select'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import type {
  EntryRoute,
  CreateEntryRouteInput,
  TrafficPool,
  Scenario,
  Tag,
} from '@line-crm/shared'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface Props {
  route: EntryRoute | null
  pools: TrafficPool[]
  scenarios: Scenario[]
  templates: MessageTemplate[]
  tags: Tag[]
  existingGenres: string[]
  initialGenre?: string
  /** Pre-filled ref_code for "register an unregistered inflow ref" flow. */
  initialRefCode?: string
  /**
   * #514-5: 親が一覧表示のために既に引いたプール別の所属名。渡されたら
   * 取り直さない。編集窓を開くたびの N+1 を無くす。
   */
  poolMemberNames?: Record<string, string[]>
  /**
   * R39: 新規作成時に所属させるLINEアカウント。一覧のヘッダー選択を渡す。
   * 更新では所属を変えないので使わない。
   */
  accountId?: string | null
  onClose: () => void
  onSaved: (savedRoute: EntryRoute, created: boolean) => void
}

export default function EditRouteModal({
  route,
  pools,
  scenarios,
  templates,
  tags,
  existingGenres,
  initialGenre,
  initialRefCode,
  poolMemberNames,
  accountId,
  onClose,
  onSaved,
}: Props) {
  // Per-pool member account names, loaded lazily so the dropdown can show
  // "Pool 名 — アカA, アカB" instead of just the pool name.
  const [poolMembers, setPoolMembers] = useState<Record<string, string[]>>(poolMemberNames ?? {})
  useEffect(() => {
    if (poolMemberNames) {
      setPoolMembers(poolMemberNames)
      return
    }
    let cancelled = false
    ;(async () => {
      const result = pools.length > 0
        ? await api.pools.listAccounts(
            pools.map((pool) => pool.id),
            { suppressFeatureDisabledEvent: true },
          ).catch(() => ({ success: false as const, data: [] }))
        : { success: true as const, data: [] }
      if (!cancelled && result.success) {
        setPoolMembers(Object.fromEntries(result.data.map(({ poolId, accounts }) => [
          poolId,
          accounts.filter((account) => account.isActive).map((account) => account.accountName ?? '—'),
        ])))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pools, poolMemberNames])
  const isNew = !route
  const mainPool = pools.find((p) => p.slug === 'main')
  // Unregistered-ref registration flow: refCode is fixed (the actual ref code
  // that has already been seen in inflow), so we lock the input to prevent
  // the user from accidentally renaming the ref and orphaning the prior stats.
  const refCodeLocked = isNew && !!initialRefCode
  const genreLocked = isNew && !!initialGenre
  const [form, setForm] = useState<CreateEntryRouteInput>(() => ({
    refCode: route?.refCode ?? initialRefCode ?? '',
    genre: route?.genre ?? initialGenre ?? '',
    name: route?.name ?? '',
    tagId: route?.tagId ?? null,
    poolId: route?.poolId ?? mainPool?.id ?? null,
    scenarioId: route?.scenarioId ?? null,
    introTemplateId: route?.introTemplateId ?? null,
    runAccountFriendAddScenarios: route?.runAccountFriendAddScenarios ?? true,
    redirectUrl: route?.redirectUrl ?? null,
    isActive: route?.isActive ?? true,
  }))
  const [submitting, setSubmitting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState('')
  /*
   * 同時編集の見分け（板 E14GFm）。編集の PATCH は開いたときの更新日時を
   * 送る。ほかの人が先に保存していたら409になり、今の中身で帯を出して
   * 比べ直す。上書きはしない。送らなければ今までどおり通す。
   */
  const [baseline, setBaseline] = useState<string | null>(route?.updatedAt ?? null)
  const [conflictLatest, setConflictLatest] = useState<EntryRoute | null>(null)
  const [comparing, setComparing] = useState(false)
  const [takenIn, setTakenIn] = useState(false)

  /** 409 の data.latest を取り出す。形が違えば null（従来の失敗扱い）。 */
  function readConflictLatest(err: unknown): EntryRoute | null {
    if (!(err instanceof ApiError) || err.status !== 409) return null
    const data = err.data as { latest?: unknown } | null | undefined
    const latest = data?.latest as Record<string, unknown> | null | undefined
    if (!latest || typeof latest !== 'object' || typeof latest.name !== 'string') return null
    return latest as unknown as EntryRoute
  }

  /*
   * 日時を「10/2 14:02」の形にする。口が返すのは JST の壁時計なので、
   * 文字列から直接抜く（Date に通すと実行環境の時差でずれる）。
   * 読めなければ空文字。
   */
  function formatSavedAt(value: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value ?? '')
    if (!m) return ''
    return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`
  }

  /** 最新を取り込んで直す。相手の保存を基準にし、入力（下書き）は残す。 */
  function takeInLatest() {
    if (!conflictLatest) return
    if (typeof conflictLatest.updatedAt === 'string') setBaseline(conflictLatest.updatedAt)
    setTakenIn(true)
  }

  const validateBeforeSave = () => {
    const nothingDelivers =
      !form.runAccountFriendAddScenarios && !form.scenarioId && !form.introTemplateId
    if (nothingDelivers) {
      setWarning(
        '上書きモードかつ起動シナリオも即時 push も未設定です。このリンクで友だち追加した人には何も届きません。続行しますか?',
      )
      return false
    }
    return true
  }

  const doSave = async () => {
    setSubmitting(true)
    setError('')
    try {
      // R39: 新規作成は所属が必須。選んでいなければ送らず理由を出す。
      if (isNew && !accountId) {
        setError('LINEアカウントを選んでください（画面上部で選べます）')
        return
      }
      const res = isNew
        ? await api.entryRoutes.create({ ...form, lineAccountId: accountId ?? null })
        : await api.entryRoutes.update(route!.id, { ...form, expectedUpdatedAt: baseline ?? undefined })
      if (res.success) {
        if (!isNew && typeof res.data.updatedAt === 'string') setBaseline(res.data.updatedAt)
        onSaved(res.data, isNew)
      } else setError(res.error ?? '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } catch (err) {
      // 409 は同時編集。帯で今の中身を見せ、入力（下書き）は残す。
      const latest = readConflictLatest(err)
      if (latest) {
        setConflictLatest(latest)
        setComparing(false)
        setTakenIn(false)
        return
      }
      // 400系はAPIの理由、403・5xxは運用の言葉へ写す（WRITE-01）。
      setError(describeSaveFailure(err))
    } finally {
      // 失敗時に「保存中…」のまま固まらないよう、必ず戻す。
      setSubmitting(false)
    }
  }

  const onSubmit = async () => {
    // If validation produced a warning, only the explicit "それでも保存"
    // button (which calls doSave directly) may bypass it. The main save
    // button must not be a second-click escape hatch.
    if (!validateBeforeSave()) return
    await doSave()
  }

  // R270: 作成と同じくフォルダは任意。空欄は未分類のまま保存する。
  const saveDisabled = submitting || !form.name.trim() || !form.refCode.trim()
  return (
    <Dialog
      open
      title={isNew ? '新規リファラルリンク' : 'リファラルリンク編集'}
      busy={submitting}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          {!isNew && conflictLatest && !takenIn ? (
            <Button onClick={takeInLatest} disabled={submitting}>
              最新を取り込んで直す
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={saveDisabled} busy={submitting}>
            {isNew ? '作る' : '保存する'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!isNew && conflictLatest ? (
          <Notice tone="warn" data-design-part="edit-conflict-band">
            {takenIn ? (
              <p className="font-semibold">
                最新の内容を取り込みました。あなたの入力は下書きのまま残っています。
                保存し直すと、その日時で比べます。
              </p>
            ) : (
              <p className="font-semibold">
                {formatSavedAt(conflictLatest.updatedAt)
                  ? `ほかの人が${formatSavedAt(conflictLatest.updatedAt)}にこの流入リンクを保存しました。`
                  : 'ほかの人がこの流入リンクを保存しました。'}
                このまま保存すると、その人の変更が消えます。
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => setComparing((v) => !v)}
                aria-expanded={comparing}
              >
                {comparing ? '比べを閉じる' : '違いを比べる'}
              </Button>
              {!takenIn ? (
                <Button type="button" onClick={takeInLatest} disabled={submitting}>
                  最新を取り込んで直す
                </Button>
              ) : null}
            </div>
            {comparing ? (
              <RouteConflictCompare
                latest={conflictLatest}
                draft={form}
                tags={tags}
                scenarios={scenarios}
                templates={templates}
                pools={pools}
              />
            ) : null}
          </Notice>
        ) : null}
        <Field label="フォルダ（任意）">
          <input
            list={genreLocked ? undefined : 'referral-genre-options'}
            value={form.genre ?? ''}
            // R270: 空欄は未分類として null で送る。空文字のまま送ると
            // 口が400ではじくため、ここで null に寄せる。
            onChange={(e) => setForm({ ...form, genre: e.target.value.trim() ? e.target.value : null })}
            readOnly={genreLocked}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
            placeholder="例: SNS（空欄なら未分類）"
            maxLength={80}
          />
          <datalist id="referral-genre-options">
            {existingGenres.map((genre) => <option key={genre} value={genre} />)}
          </datalist>
          <p className="text-ink-faint mt-1 text-xs">
            {genreLocked
              ? '左側で選択したフォルダへ登録されます。'
              : '同じ協力会社や媒体を同じフォルダ名にすると、一覧でまとめて管理できます。空欄のまま保存すると未分類になります。'}
          </p>
        </Field>

        <Field label="流入元の名前">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
            placeholder="例: Instagram プロフィール"
            maxLength={120}
          />
        </Field>

        <Field label="URLに出る識別子">
          <input
            value={form.refCode}
            onChange={(e) => setForm({ ...form, refCode: e.target.value })}
            // R271: 作成済みの識別子は口も変更を拒否する。保存時にはじめて
            // 拒否せず、欄自体を読み取り専用にして理由を近くに出す。
            disabled={refCodeLocked || !isNew}
            className="border-hairline rounded-control bg-canvas text-ink disabled:bg-canvas-sunken disabled:text-ink-faint w-full border px-3 py-2 font-mono text-sm"
            placeholder="例: youtube"
          />
          {refCodeLocked && (
            <p className="text-ink-faint mt-1 text-xs">
              既に流入があった識別子を登録中のため、URLに出る識別子は変更できません。
            </p>
          )}
          {!isNew && (
            <p className="text-ink-faint mt-1 text-xs">
              URLに出る識別子は作成後に変更できません。新しいURLが必要な場合は、新しいリンクを作成してください。
            </p>
          )}
        </Field>

        <Field label="自動付与タグ（任意）">
          <Combobox
            aria-label="自動付与タグ（任意）"
            placeholder="— 設定なし —"
            value={form.tagId ?? ''}
            onChange={(next) => setForm({ ...form, tagId: next || null })}
            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            className="w-full"
          />
          <p className="text-ink-faint mt-1 text-xs">
            友だち追加時にこのタグを自動付与します。タグ未作成の場合は先にタグを作成してください。
          </p>
        </Field>

        <Field label="送り先 Pool">
          <Select
            aria-label="送り先 Pool"
            value={form.poolId ?? ''}
            onChange={(value) => setForm({ ...form, poolId: value || null })}
            size="full"
            options={pools.map((p) => {
              const members = poolMembers[p.id] ?? []
              const memberText =
                members.length === 0
                  ? '（アカウント未所属）'
                  : `— ${members.join(', ')}`
              return {
                value: p.id,
                label: `${p.name}${p.slug === 'main' ? '（既定）' : ''} ${memberText}`,
              }
            })}
          />
        </Field>

        <Field label="起動シナリオ（任意）">
          <Combobox
            aria-label="起動シナリオ（任意）"
            placeholder="— 設定なし —"
            value={form.scenarioId ?? ''}
            onChange={(next) => setForm({ ...form, scenarioId: next || null })}
            options={scenarios.map((s) => ({ value: s.id, label: s.name }))}
            className="w-full"
          />
        </Field>

        <Field label="即時 push テンプレ（任意）">
          <Combobox
            aria-label="即時 push テンプレ（任意）"
            placeholder="— 設定なし —"
            value={form.introTemplateId ?? ''}
            onChange={(next) => setForm({ ...form, introTemplateId: next || null })}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
            className="w-full"
          />
        </Field>

        <Checkbox
          checked={form.runAccountFriendAddScenarios ?? true}
          onCheckedChange={(checked) => {
            setForm({
              ...form,
              runAccountFriendAddScenarios: checked,
            })
            setWarning(null)
          }}
          description="OFF にするとアカウント標準シナリオは抑止され、このリンクの設定だけが流れます。"
        >アカウント標準の友だち追加時設定も実行する（並走モード）</Checkbox>

        {warning && (
          <Notice
            tone="warn"
            message={warning}
            action={(
              <Button
                onClick={doSave}
                disabled={submitting}
              >
                それでも保存する
              </Button>
            )}
          />
        )}
      </div>
    </Dialog>
  )
}

/*
 * 同時編集の比べ（板 E14GFm）。違う項目だけを「自分の変更（下書き）」と
 * 「今の保存内容」で並べる。上書きはしない。
 * この窓だけの部品（共通部品は変えない）。
 */
function RouteConflictCompare({
  latest,
  draft,
  tags,
  scenarios,
  templates,
  pools,
}: {
  latest: EntryRoute
  draft: CreateEntryRouteInput
  tags: Tag[]
  scenarios: Scenario[]
  templates: MessageTemplate[]
  pools: TrafficPool[]
}) {
  const nameOf = (list: Array<{ id: string; name: string }>, id: string | null | undefined): string => {
    if (id === null || id === undefined || id === '') return '未設定'
    return list.find((item) => item.id === id)?.name ?? '未設定'
  }
  const rows: Array<{ label: string; mine: string; theirs: string }> = [
    { label: '名前', mine: draft.name.trim() || '—', theirs: latest.name },
    { label: 'フォルダ', mine: draft.genre?.trim() || '未分類', theirs: latest.genre?.trim() || '未分類' },
    { label: '自動付与タグ', mine: nameOf(tags, draft.tagId), theirs: nameOf(tags, latest.tagId) },
    { label: '起動シナリオ', mine: nameOf(scenarios, draft.scenarioId), theirs: nameOf(scenarios, latest.scenarioId) },
    { label: '即時 push テンプレ', mine: nameOf(templates, draft.introTemplateId), theirs: nameOf(templates, latest.introTemplateId) },
    { label: '送り先 Pool', mine: nameOf(pools, draft.poolId), theirs: nameOf(pools, latest.poolId) },
    { label: '行き先 URL', mine: draft.redirectUrl?.trim() || '未設定', theirs: latest.redirectUrl?.trim() || '未設定' },
    { label: '公開', mine: draft.isActive ? 'する' : 'しない', theirs: latest.isActive ? 'する' : 'しない' },
  ].filter((row) => row.mine !== row.theirs)
  return (
    <div className="mt-2">
      <p>
        同じ流入リンクの、違う項目だけ並べています。
        上書きはできません。「最新を取り込んで直す」を選ぶと、相手の保存を取り込み、
        あなたの変更は下書きに残したまま直せます。
      </p>
      {rows.length === 0 ? (
        <p className="mt-1">内容に違いはありません。最新の日時で保存し直せます。</p>
      ) : (
        <table className="mt-2 w-full table-fixed text-xs" data-design-part="edit-conflict-compare">
          <thead>
            <tr className="text-left text-ink-secondary">
              <th className="w-28 py-1 pr-2 font-medium">項目</th>
              <th className="py-1 pr-2 font-medium">自分の変更（下書き）</th>
              <th className="py-1 font-medium">今の保存内容</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-1 pr-2 text-left font-medium text-ink-secondary">{row.label}</th>
                <td className="truncate py-1 pr-2" title={row.mine}>{row.mine}</td>
                <td className="truncate py-1" title={row.theirs}>{row.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-ink-secondary mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
