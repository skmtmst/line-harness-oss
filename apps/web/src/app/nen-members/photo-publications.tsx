'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import { Tabs } from '@/components/shared/tabs'
import { safePhotoSrc } from './photo-src'
import { photoPetDisplayName } from '@/components/shared/photo-display-name'
import { formatPhotoReceivedAt } from './photo-review-time'
import { mileStatusLabel, text } from './photo-text'

const views = (value: unknown) => value == null ? '—（未取得）' : `${Number(value).toLocaleString('ja-JP')}回`
const PLACEMENT_CHOICES = [
  { type: 'rich_menu', label: 'リッチメニュー' },
  { type: 'column', label: 'NENコラム' },
  { type: 'form', label: '回答フォーム' },
  { type: 'site', label: 'サイト' },
] as const

type PublicationRow = Record<string, unknown> & {
  placements?: Array<Record<string, unknown>>
}
type PublicationsData = {
  summary: {
    publishedCount: number
    placementCount: number
    topPhoto: Record<string, unknown> | null
    consentedCount: number
    attentionCount?: number
    withdrawnCount?: number
  }
  items: PublicationRow[]
  pendingWithdrawals?: PublicationRow[]
  withdrawnItems?: PublicationRow[]
}

/*
 * 掲載先1件の状態を行で出す（Issue #1040 IDEA-22）。
 * active=1 は掲載中（開始日から）、active=0 は外した先（外した日つき）。
 * 期間の終わりが無いものは「掲載中」とだけ出し、期限を推測しない。
 */
function PlacementLine({ placement }: { placement: Record<string, unknown> }) {
  const active = Number(placement.active ?? 1) === 1
  return <span className="block truncate" title={text(placement.placement_label)}>
    {text(placement.placement_label)}／{views(placement.view_count)}・{active
      ? `${formatPhotoReceivedAt(placement.created_at)}から掲載中`
      : `${formatPhotoReceivedAt(placement.removed_at)}に外しました`}
  </span>
}

function placementsOf(row: PublicationRow): Array<Record<string, unknown>> {
  return Array.isArray(row.placements) ? row.placements : []
}

/* 掲載先のうち、登録上まだ残っているもの（撤回後に残る公開先）。 */
function remainingPlacements(row: PublicationRow) {
  return placementsOf(row).filter((placement) => Number(placement.active ?? 1) === 1)
}

/*
 * 「整理が必要」に入った理由を業務の言葉で返す。本人の撤回・同意なし・
 * 採用でなくなったものを分け、推測で断定しない。
 */
function pendingReason(item: PublicationRow): string {
  if (text(item.publication_withdrawn_at)) {
    return `ご本人が公開の同意を撤回しました（${formatPhotoReceivedAt(item.publication_withdrawn_at)}）`
  }
  if (!text(item.publication_consent_at)) return '公開の同意が確認できません'
  if (text(item.photo_status) && text(item.photo_status) !== 'adopted') {
    return '採用状態ではなくなっています'
  }
  return '掲載状態の確認が必要です'
}

export function PhotoPublications({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const [data, setData] = useState<PublicationsData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [selectedPlacements, setSelectedPlacements] = useState<string[]>([])
  const load = useCallback(async () => {
    setState('loading')
    try {
      const response = await api.nenMembers.photoPublications(accountId)
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setData({
          summary: { publishedCount: 0, placementCount: 0, topPhoto: null, consentedCount: 0 },
          items: [], pendingWithdrawals: [], withdrawnItems: [],
        })
        setState('ready')
        return
      }
      setData(response.data)
      setState('ready')
    } catch (error) {
      setData(null)
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  const withdraw = async (publication: Record<string, unknown>) => {
    setBusyId(text(publication.id))
    setNotice('')
    try {
      await api.nenMembers.withdrawPhotoPublication(text(publication.id), {
        accountId, expectedVersion: Number(publication.version),
      }, crypto.randomUUID())
      setNotice('写真をすべての掲載先から外しました。審査と同意の履歴、付与済みのマイルは残ります。')
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載状態を変更しました。最新の状態を読み直してください。'
        : '写真を掲載先から外せませんでした。')
    } finally { setBusyId('') }
  }

  const openPlacements = (publication: Record<string, unknown>) => {
    const current = placementsOf(publication).filter((placement) => Number(placement.active ?? 1) === 1)
    setEditing(publication)
    setSelectedPlacements(current.map((placement) => text(placement.placement_type)))
  }

  const savePlacements = async () => {
    if (!editing) return
    setBusyId(text(editing.id))
    try {
      await api.nenMembers.updatePhotoPublicationPlacements(text(editing.id), {
        accountId,
        expectedVersion: Number(editing.version),
        placements: PLACEMENT_CHOICES.filter((choice) => selectedPlacements.includes(choice.type)),
      }, crypto.randomUUID())
      setEditing(null)
      setNotice('写真を使う場所を更新しました。')
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載先を変更しました。最新の状態を読み直してください。'
        : '写真を使う場所を保存できませんでした。')
      setEditing(null)
    } finally { setBusyId('') }
  }

  if (state === 'loading') return <div><ListState kind="loading" title="公式サイト掲載中の写真を読み込んでいます" /></div>
  if (state === 'forbidden') return <div><ListState kind="forbidden" /></div>
  if (state === 'error') return <div><ListState kind="error" title="公式サイト掲載中の写真を読み込めませんでした" onRetry={() => void load()} /></div>

  const items = data?.items ?? []
  const pendingWithdrawals = Array.isArray(data?.pendingWithdrawals) ? data.pendingWithdrawals : []
  const withdrawnItems = Array.isArray(data?.withdrawnItems) ? data.withdrawnItems : []
  if (!data || (items.length === 0 && pendingWithdrawals.length === 0 && withdrawnItems.length === 0)) {
    return <div><Button onClick={onBack}>写真審査へ戻る</Button><ListState kind="empty" title="公式サイト掲載中の写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" /></div>
  }

  const top = data.summary.topPhoto
  return <><div data-photo-view="publications">
    <div className="flex items-center justify-between gap-2 max-md:flex-col max-md:items-start">
      <div><p className="text-xs font-bold text-ink-faint">専用機能</p><h2 className="mt-1 text-2xl font-extrabold text-ink">写真審査</h2></div>
      <Button onClick={onBack}>審査待ちへ戻る</Button>
    </div>
    <Tabs items={[{ label: '公式サイト掲載', current: true }, { label: '並び順を変える', disabled: true }]} />
    {notice && <div className="mt-4"><Notice tone={notice.includes('できません') || notice.includes('変更しました') ? 'error' : 'success'} message={notice} /></div>}
    <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card padding="default"><span className="block text-xs text-ink-faint">公式サイト掲載中の写真</span><strong className="my-1 block text-2xl text-ink">{data.summary.publishedCount}枚</strong><small className="block text-xs text-ink-faint">採用した写真のうち</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">どこで使っているか</span><strong className="my-1 block text-2xl text-ink">{data.summary.placementCount}か所</strong><small className="block text-xs text-ink-faint">現在つながっている掲載先</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">いちばん見られた</span><strong className="my-1 block truncate text-2xl text-ink">{top ? photoPetDisplayName(top.pet_name, { honorific: false }) : '—（未取得）'}</strong><small className="block text-xs text-ink-faint">{top ? views(top.view_count) : '表示回数は未取得'}</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">ご本人の同意</span><strong className="my-1 block text-2xl text-ink">{data.summary.consentedCount}枚 すべて</strong><small className="block text-xs text-ink-faint">投稿時に同意をいただいています</small></Card>
    </section>
    <div className="mt-4"><NoteBar>公式サイト掲載中の写真は、投稿してくださった方の名前を写真ごとに伏せられます。ご本人の希望があれば、すべての掲載先から外せます。外しても採用時に付けたマイルは戻りません。</NoteBar></div>
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-5">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:col-span-4 xl:grid-cols-4">
        {items.length === 0 && <p className="col-span-full rounded-control border border-hairline bg-canvas px-4 py-3 text-sm text-ink-faint">いま公式サイト掲載中の写真はありません。</p>}
        {items.map((item) => {
          const placements = placementsOf(item)
          const imageSrc = safePhotoSrc(item.image_url)
          return <Card key={text(item.id)} layout="vertical" overflow="hidden">
            {imageSrc ? <img className="h-36 w-full object-cover" src={imageSrc} alt={`${photoPetDisplayName(item.pet_name, { honorific: false })}の公開写真`} loading="lazy" /> : <div className="grid h-36 w-full place-items-center bg-canvas-sunken text-xs font-bold text-ink-faint">{text(item.image_url) ? '画像を表示できません' : '公開用画像を作成中です'}</div>}
            <div className="p-2.5"><strong className="text-sm text-ink">{views(item.view_count)}</strong><h2 className="mt-0.5 text-base font-extrabold text-ink">{photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })}</h2><p className="mt-0.5 text-xs text-ink-faint">{text(item.owner_name) || '名前は伏せています'}</p>
              <div className="mt-1 text-xs text-ink-faint">{placements.length ? placements.map((placement) => <PlacementLine key={text(placement.id)} placement={placement} />) : <span>どこにも出していません</span>}</div>
              {/*
               * 公開先ごとの同意・採用・マイルの記録（Issue #1040 IDEA-22）。
               * 同意は写真ごと、掲載先ごとの取り外しは上の行で見る。
               */}
              <dl className="mt-2 space-y-1 border-t border-hairline pt-2 text-xs text-ink-faint">
                <div className="flex justify-between gap-2"><dt>公開の同意</dt><dd className="text-right">{text(item.publication_consent_at) ? `${formatPhotoReceivedAt(item.publication_consent_at)}${text(item.publication_consent_version) ? `（${text(item.publication_consent_version)}）` : ''}` : '未取得'}</dd></div>
                <div className="flex justify-between gap-2"><dt>採用の記録</dt><dd className="text-right">{text(item.reviewed_at) ? `${formatPhotoReceivedAt(item.reviewed_at)}・${text(item.reviewed_by_name) || '担当未取得'}` : '—（未取得）'}</dd></div>
                <div className="flex justify-between gap-2"><dt>マイル</dt><dd className="text-right">{mileStatusLabel(item.point_sync_status, Number(item.awarded_points) || 5)}</dd></div>
              </dl>
              <div className="mt-2 flex items-center gap-2"><Button data-qa-open="J3Wxl8-placements" onClick={() => openPlacements(item)}>使う場所</Button><Button disabled={busyId === item.id} onClick={() => void withdraw(item)}>{busyId === item.id ? '外しています...' : '外す'}</Button></div>
            </div>
          </Card>
        })}
      </section>
      <aside className="space-y-3">
        <Card padding="default"><h2 className="text-sm font-extrabold text-ink">出すときの決めごと</h2><p className="mt-2 text-xs text-ink-secondary">投稿のときに公開への同意をいただいた写真だけを出します。</p><p className="mt-2 text-xs text-ink-secondary">名前は写真ごとに伏せられます。</p><p className="mt-2 text-xs text-ink-secondary">外すと、登録したすべての掲載先から外れ、審査と同意の履歴は残ります。</p><p className="mt-2 text-xs text-ink-secondary">公開の期限は設けていません。外す操作をするまで掲載され続けます。外しても採用時のマイルは戻りません。</p></Card>
        <FeatureLinkCard items={[{ label: 'リッチメニュー', note: '写真を使う場所' }, { label: 'NENコラム', note: '公開写真を紹介する' }, { label: '回答フォーム', note: '回答画面へ表示する' }, { label: '登録メディア', note: '公開用画像の置き場' }]} />
      </aside>
    </div>

    {/*
     * 撤回後に残る公開先（Issue #1040 IDEA-22）。
     * ご本人が同意を撤回しても掲載先の登録は残る。ここで残っている先を
     * 確認して「掲載先から外す」で整理を完了させる。自動では外さない。
     */}
    {pendingWithdrawals.length > 0 && <section className="mt-6">
      <h2 className="text-sm font-extrabold text-ink">整理が必要なもの（{pendingWithdrawals.length}件）</h2>
      <p className="mt-1 text-xs text-ink-faint">同意の状態と掲載先の登録が合っていないものです。残っている掲載先を確認して、外す操作で整理を完了させてください。</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {pendingWithdrawals.map((item) => {
          const remaining = remainingPlacements(item)
          const imageSrc = safePhotoSrc(item.image_url)
          return <Card key={text(item.id)} layout="vertical" overflow="hidden">
            {imageSrc ? <img className="h-36 w-full object-cover" src={imageSrc} alt={`${photoPetDisplayName(item.pet_name, { honorific: false })}の写真`} loading="lazy" /> : <div className="grid h-36 w-full place-items-center bg-canvas-sunken text-xs font-bold text-ink-faint">画像を表示できません</div>}
            <div className="p-2.5">
              <h3 className="text-base font-extrabold text-ink">{photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })}</h3>
              <p className="mt-0.5 text-xs font-semibold text-status-warn-deep">{pendingReason(item)}</p>
              <div className="mt-2 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep">
                {remaining.length > 0
                  ? `まだ残っている掲載先：${remaining.map((placement) => text(placement.placement_label)).join('、')}`
                  : '掲載先の登録だけが残っています'}
              </div>
              <div className="mt-1 text-xs text-ink-faint">{placementsOf(item).map((placement) => <PlacementLine key={text(placement.id)} placement={placement} />)}</div>
              <p className="mt-2 border-t border-hairline pt-2 text-xs text-ink-faint">マイル：{mileStatusLabel(item.point_sync_status, Number(item.awarded_points) || 5)}（外しても付与済みのマイルは戻りません）</p>
              <div className="mt-2"><Button disabled={busyId === item.id} onClick={() => void withdraw(item)}>{busyId === item.id ? '外しています...' : '掲載先から外す'}</Button></div>
            </div>
          </Card>
        })}
      </div>
    </section>}

    {/* 外し終えた履歴。同意・審査・マイルの記録は残す（Issue #1040 IDEA-22）。 */}
    {withdrawnItems.length > 0 && <section className="mt-6">
      <h2 className="text-sm font-extrabold text-ink">外したもの（{withdrawnItems.length}件）</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {withdrawnItems.map((item) => {
          const imageSrc = safePhotoSrc(item.image_url)
          return <Card key={text(item.id)} layout="vertical" overflow="hidden">
            {imageSrc ? <img className="h-36 w-full object-cover" src={imageSrc} alt={`${photoPetDisplayName(item.pet_name, { honorific: false })}の写真`} loading="lazy" /> : <div className="grid h-36 w-full place-items-center bg-canvas-sunken text-xs font-bold text-ink-faint">画像を表示できません</div>}
            <div className="p-2.5">
              <h3 className="text-base font-extrabold text-ink">{photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })}</h3>
              <p className="mt-0.5 text-xs text-ink-faint">外した日時：{formatPhotoReceivedAt(item.withdrawn_at)}{text(item.withdrawn_by_name) ? `・${text(item.withdrawn_by_name)}` : ''}</p>
              <div className="mt-1 text-xs text-ink-faint">{placementsOf(item).length ? placementsOf(item).map((placement) => <PlacementLine key={text(placement.id)} placement={placement} />) : <span>掲載先の記録はありません</span>}</div>
              <p className="mt-2 border-t border-hairline pt-2 text-xs text-ink-faint">マイル：{mileStatusLabel(item.point_sync_status, Number(item.awarded_points) || 5)}（付与済みのマイルは戻りません）</p>
            </div>
          </Card>
        })}
      </div>
    </section>}
  </div>
  {editing && <Dialog
    open
    title={`${text(editing.pet_name) || 'この写真'}を使う場所`}
    description="選んだ場所へ公開用画像を出します。原本は公開しません。"
    confirmLabel="使う場所を保存"
    cancelLabel="戻る"
    busy={busyId === editing.id}
    onCancel={() => setEditing(null)}
    onConfirm={() => void savePlacements()}
  >
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-extrabold text-ink">使う場所</legend>
      {PLACEMENT_CHOICES.map((choice) => <label className="flex items-center gap-2 rounded-control border border-hairline p-3 text-xs font-bold text-ink-secondary" key={choice.type}>
        <input
          type="checkbox"
          checked={selectedPlacements.includes(choice.type)}
          onChange={(event) => setSelectedPlacements((current) => event.target.checked
            ? [...current, choice.type]
            : current.filter((value) => value !== choice.type))}
        />
        <span>{choice.label}</span>
      </label>)}
      <p className="text-xs leading-relaxed text-ink-faint">何も選ばず保存すると、現在の掲載先だけを外します。写真の公開同意と審査履歴は残ります。</p>
    </fieldset>
  </Dialog>}
  </>
}
