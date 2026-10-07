'use client'

/*
 * ★V8 予約サイト・グルメ媒体（提案 E-4 `aSmph`。設定の中の1画面）。
 *
 * 店ごと×媒体ごとに「店舗ページの URL」「管理画面（ログイン）の URL」（https だけ）を持ち、
 * 他のサイトの枠を閉じる知らせを出す媒体（closeOnBooking）を選ぶ。予約を受けないグルメ媒体も足せる。
 * LINE 予約を他のサイトに貼る URL と貼り付け用のコードは、口が `available:false` を返すあいだ
 * 「まだ使えません」の案内だけを出し、コピーしない（決まりで「準備中」とは書かない）。
 * 保存した URL は「今日のお店」の右の列と「枠を閉じる知らせ」の［管理画面を開く ↗］に使われる。
 * 動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Info, MessageCircle, Plus } from 'lucide-react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import StickyBar from '@/components/shared/sticky-bar'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SectionHeader from '@/components/shared/section-header'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import { TextField } from '@/components/shared/text-field'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { useHideSettingsNav, usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { ApiError, fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantStore } from '@/lib/restaurant-test-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './screen.module.css'

export type MediaRow = {
  code: string
  name: string
  acceptsReservations: boolean
  pageUrl: string | null
  loginUrl: string | null
  closeOnBooking: boolean
  version: number
}

type ChannelState = { code: string; status?: string; daysWithoutReceipt?: number | null; receiveMethod?: string }

/** https だけ。ID・パスワード入りの URL は断る（口と同じ条件）。空は「消す」。 */
export function checkHttpsUrl(value: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = value.trim()
  if (!text) return { ok: true, value: null }
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return { ok: false, message: 'https:// で始まる URL を入れてください' }
    if (url.username || url.password) return { ok: false, message: 'ID やパスワードの入った URL は保存できません' }
    return { ok: true, value: url.href }
  } catch {
    return { ok: false, message: 'URL の形を確かめてください（https:// から）' }
  }
}

/** 表に出す URL（https:// と末尾を省き、↗ を付ける）。 */
export function shortUrl(url: string): string {
  return url.replace(/^https:\/\//, '')
}

/** 予約メールの取り込みの札。グルメ媒体（予約を受けない）は「取り込まない」。 */
export function importBadge(row: Pick<MediaRow, 'acceptsReservations' | 'code'>, channel: ChannelState | undefined): { label: string; tone: StatusBadgeTone } {
  if (!row.acceptsReservations) return { label: '取り込まない', tone: 'neutral' }
  /* Google の予約はメールではなく Google ビジネスの連携で入る。 */
  if (row.code === 'google') return { label: 'Google ビジネスと連携', tone: 'info' }
  if (!channel) return { label: '未設定', tone: 'neutral' }
  if (channel.status === 'receiving') return { label: '取り込み中', tone: 'success' }
  if (channel.status === 'not_receiving') return { label: `${channel.daysWithoutReceipt ?? 0}日届いていません`, tone: 'warning' }
  return { label: '未設定', tone: 'neutral' }
}

/** グルメ媒体のコード（gourmet_ で始まる英小文字・数字）。名前からは作れないので時刻から作る。 */
export function gourmetCode(now = Date.now()): string {
  return `gourmet_${now.toString(36)}`
}

function sameRow(a: MediaRow, b: MediaRow): boolean {
  return a.pageUrl === b.pageUrl && a.loginUrl === b.loginUrl && a.closeOnBooking === b.closeOnBooking
}

function UrlCell({ url }: { url: string | null }) {
  if (!url) return <span className={styles.none}>—</span>
  return (
    <a className={styles.url} href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {`${shortUrl(url)} ↗`}
    </a>
  )
}

export default function BookingMediaPage() {
  usePageTitle('予約サイト・グルメ媒体')
  usePageCrumbs([{ label: '設定', href: '/settings' }])
  /* 絵（aSmph）には設定の中のメニューが無い。この画面だけ出さない（SNS 連携と同じ）。 */
  useHideSettingsNav()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)

  const [stores, setStores] = useState<RestaurantStore[]>([])
  const [storeId, setStoreId] = useState('')
  const [saved, setSaved] = useState<MediaRow[] | null>(null)
  const [rows, setRows] = useState<MediaRow[]>([])
  const [channels, setChannels] = useState<ChannelState[]>([])
  const [loadError, setLoadError] = useState<unknown>(null)
  const [link, setLink] = useState<{ url: string; html: string; available: boolean } | null>(null)
  const [linkError, setLinkError] = useState('')
  const [linkAsked, setLinkAsked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [editing, setEditing] = useState<MediaRow | null>(null)
  const [editPage, setEditPage] = useState('')
  const [editLogin, setEditLogin] = useState('')
  const [editError, setEditError] = useState('')
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  /* 店舗：選んでいる店舗（store-context）→ 無ければ先頭（今日のお店と同じ）。 */
  useEffect(() => {
    let current = true
    if (!selectedAccountId) return
    void Promise.all([
      restaurantTestApi.listStores(selectedAccountId),
      restaurantTestApi.storeContext(selectedAccountId).catch(() => null),
    ]).then(([list, context]) => {
      if (!current) return
      const selected = context?.data.selectedStore?.id
      setStores(list.data.stores)
      setStoreId(list.data.stores.some((s) => s.id === selected) ? selected! : list.data.stores[0]?.id ?? '')
      if (list.data.stores.length === 0) setSaved([])
    }).catch((caught) => { if (current) setLoadError(caught) })
    return () => { current = false }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (!selectedAccountId || !storeId) return
    try {
      const [links, channelRows] = await Promise.all([
        restaurantTestApi.mediaLinks(selectedAccountId, storeId),
        fetchApi<{ success: true; data: ChannelState[] }>(`/api/restaurant-test/channels?account_id=${encodeURIComponent(selectedAccountId)}&storeId=${encodeURIComponent(storeId)}`)
          .then((res) => res.data).catch(() => [] as ChannelState[]),
      ])
      const next = links.data.map((row) => ({
        code: row.code,
        name: row.name,
        acceptsReservations: !!row.acceptsReservations,
        pageUrl: row.pageUrl,
        loginUrl: row.loginUrl,
        closeOnBooking: !!row.closeOnBooking,
        version: row.version,
      }))
      setSaved(next); setRows(next); setChannels(channelRows); setLoadError(null); setConflict(false)
    } catch (caught) {
      setLoadError(caught)
    }
  }, [selectedAccountId, storeId])
  useEffect(() => { void load() }, [load])

  /* 貼り付け用の URL は管理者だけが出せる口（POST）。担当者には案内だけ。 */
  useEffect(() => {
    let current = true
    if (!selectedAccountId || !storeId || role === null || !canManageRole(role)) return
    void restaurantTestApi.reservationLink(selectedAccountId, storeId)
      .then((res) => { if (current) { setLink(res.data); setLinkError('') } })
      .catch((caught) => {
        if (!current) return
        setLink(null)
        setLinkError(caught instanceof ApiError && caught.status === 503 ? 'お客さま向けの予約ページの設定がまだ無いため、URL を出せません。' : '予約ページの URL を読み込めませんでした。')
      })
    return () => { current = false }
  }, [selectedAccountId, storeId, role])

  const dirty = useMemo(() => {
    if (!saved) return [] as MediaRow[]
    return rows.filter((row) => {
      const before = saved.find((s) => s.code === row.code)
      return !before || !sameRow(before, row)
    })
  }, [rows, saved])

  /* 保存していない変更があるまま離れるときは確かめる。 */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: dirty.length > 0, busy: saving })

  const bookable = rows.filter((row) => row.acceptsReservations)
  const closeOn = bookable.some((row) => row.closeOnBooking)
  const setRow = (code: string, patch: Partial<MediaRow>) => setRows((list) => list.map((row) => (row.code === code ? { ...row, ...patch } : row)))
  const setAllClose = (on: boolean) => setRows((list) => list.map((row) => (row.acceptsReservations ? { ...row, closeOnBooking: on } : row)))

  const openEdit = (row: MediaRow) => {
    setEditing(row); setEditPage(row.pageUrl ?? ''); setEditLogin(row.loginUrl ?? ''); setEditError('')
  }
  const applyEdit = () => {
    if (!editing) return
    const page = checkHttpsUrl(editPage)
    const login = checkHttpsUrl(editLogin)
    if (!page.ok) { setEditError(`店舗ページ：${page.message}`); return }
    if (!login.ok) { setEditError(`管理画面：${login.message}`); return }
    setRow(editing.code, { pageUrl: page.value, loginUrl: login.value })
    setEditing(null)
  }

  const addMedium = async () => {
    const name = addName.trim()
    if (!name) { setAddError('媒体の名前を入れてください'); return }
    if (!selectedAccountId) return
    setAddBusy(true); setAddError('')
    try {
      await restaurantTestApi.addGourmetMedia(selectedAccountId, { code: gourmetCode(), name })
      setAdding(false); setAddName('')
      notifyToast(`グルメ媒体「${name}」を足しました。URL は行の「…」から入れます`)
      await load()
    } catch (caught) {
      setAddError(caught instanceof ApiError && caught.status === 409 ? '同じ媒体が登録済みです' : '媒体を足せませんでした。もう一度お試しください')
    } finally {
      setAddBusy(false)
    }
  }

  const save = async () => {
    if (!selectedAccountId || !storeId || dirty.length === 0) return
    setSaving(true); setSaveError('')
    try {
      for (const row of dirty) {
        await restaurantTestApi.saveMediaLink(selectedAccountId, row.code, {
          storeId, pageUrl: row.pageUrl, loginUrl: row.loginUrl, closeOnBooking: row.acceptsReservations && row.closeOnBooking, expectedVersion: row.version,
        })
      }
      notifyToast('予約サイト・グルメ媒体の設定を保存しました')
      await load()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) setConflict(true)
      else setSaveError(caught instanceof ApiError && caught.status === 400 ? 'URL は https:// で始まるものだけ保存できます。行の「…」から直してください。' : '保存できませんでした。もう一度お試しください。')
      /* 途中まで保存できた行があるので、版を読み直す（入力は残す）。 */
    } finally {
      setSaving(false)
    }
  }

  const askLink = () => setLinkAsked(true)
  const copyText = async (text: string, what: string) => {
    if (!link?.available) { askLink(); return }
    try { await navigator.clipboard.writeText(text); notifyToast(`${what}をコピーしました`) } catch { notifyToast(`${what}をコピーできませんでした`) }
  }

  let table
  if (loadError && !saved) table = <ListState kind="error" error={loadError} onRetry={() => void load()} />
  else if (!saved) table = <ListState kind="loading" />
  else if (rows.length === 0) table = <p className={styles.text}>媒体がまだありません。右上の［媒体を足す］から足せます。</p>
  else {
    table = (
      <DataTable className={styles.table} data-design="booking-media">
        <thead>
          <TableHeadRow className={styles.headRow}>
            <Th className={styles.colName}>媒体</Th>
            <Th className={styles.colPage}>店舗ページの URL</Th>
            <Th className={styles.colLogin}>管理画面（ログイン）の URL</Th>
            <Th className={styles.colImport}>予約メールの取り込み</Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = importBadge(row, channels.find((c) => c.code === row.code))
            const changed = dirty.some((d) => d.code === row.code)
            return (
              <Tr key={row.code} className={styles.row} data-dirty={changed || undefined}>
                <Td className={styles.colName}>
                  <span className={styles.nameCell}>
                    <span className={styles.mark} aria-hidden="true">{row.name.slice(0, 1)}</span>
                    <span className={styles.name} title={row.name}>{row.name}</span>
                  </span>
                </Td>
                <Td className={styles.colPage}><UrlCell url={row.pageUrl} /></Td>
                <Td className={styles.colLogin}><UrlCell url={row.loginUrl} /></Td>
                <Td className={styles.colImport}>
                  <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                </Td>
                <Td className={styles.colMenu}>
                  {canManage ? (
                    <RowActions
                      subjectName={row.name}
                      menuItems={[
                        { id: 'edit', label: 'URL を変える', onSelect: () => openEdit(row) },
                        ...(row.acceptsReservations ? [{
                          id: 'close',
                          label: row.closeOnBooking ? '枠を閉じる知らせの対象から外す' : '枠を閉じる知らせの対象にする',
                          icon: row.closeOnBooking ? <Check size={14} aria-hidden="true" /> : undefined,
                          onSelect: () => setRow(row.code, { closeOnBooking: !row.closeOnBooking }),
                        }] : []),
                        ...(row.pageUrl ? [{ id: 'open-page', label: '店舗ページを開く', external: true, onSelect: () => { window.open(row.pageUrl!, '_blank', 'noopener,noreferrer') } }] : []),
                        ...(row.loginUrl ? [{ id: 'open-login', label: '管理画面を開く', external: true, onSelect: () => { window.open(row.loginUrl!, '_blank', 'noopener,noreferrer') } }] : []),
                      ]}
                    />
                  ) : null}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    )
  }

  const closeTargets = bookable.filter((row) => row.closeOnBooking).map((row) => row.name)

  return (
    <>
      <PageFrame kind="settings" boardId="aSmph" hasFooter={canManage}>
        <PageHeading
          headingSize="compact"
          title="予約サイト・グルメ媒体"
          help="店ごとに、予約サイト・グルメ媒体の店舗ページと管理画面（ログイン）の URL を持ちます。管理画面の URL は「今日のお店」と「枠を閉じる知らせ」の［管理画面を開く］に使います。"
          actions={(
            <span className={styles.headActions}>
              {stores.length > 1 ? (
                <span className={styles.storeSelect}>
                  <Select aria-label="店舗" value={storeId} onChange={(value) => setStoreId(value)} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
                </span>
              ) : null}
              {canManage ? <Button onClick={() => { setAdding(true); setAddName(''); setAddError('') }}><Plus size={15} aria-hidden="true" />媒体を足す</Button> : null}
            </span>
          )}
        />
        <div className={styles.body}>
          {conflict ? (
            <Notice tone="warn" role="alert" action={<Button size="compact" onClick={() => void load()}>読み直す</Button>}>
              ほかの人が先にこの店の媒体の設定を変えました。読み直してから、もう一度変えてください。
            </Notice>
          ) : null}
          {saveError ? <Notice tone="danger" role="alert">{saveError}</Notice> : null}

          <section className={styles.section} aria-label="つないでいる媒体">
            <SectionHeader
              title="つないでいる媒体"
              help="予約サイトは予約メールを取り込み、グルメ媒体（予約を受けない）は URL だけを持ちます。URL は https:// で始まるものだけ保存できます。"
              helpLabel="つないでいる媒体の説明"
            />
            {table}
          </section>

          <section className={styles.section} aria-label="LINE 予約を他のサイトに貼る">
            <SectionHeader
              title="LINE 予約を他のサイトに貼る"
              help="LINE で予約できるページの URL と、ホームページなどに貼るボタンのコードです。"
              helpLabel="LINE 予約を他のサイトに貼るの説明"
            />
            <div className={styles.cards}>
              <div className={styles.card}>
                <p className={styles.cardTitle}>予約ページの URL</p>
                <p className={styles.cardText}>Instagram のプロフィール・Google ビジネスの予約ボタン・ホームページに貼れます</p>
                {canManage ? (
                  <div className={styles.urlRow}>
                    <span className={styles.urlBox} title={link?.url}>{link?.url ?? (linkError || '読み込んでいます…')}</span>
                    <Button onClick={() => void copyText(link?.url ?? '', '予約ページの URL')} disabled={!link}><Copy size={15} aria-hidden="true" />コピー</Button>
                  </div>
                ) : (
                  <p className={styles.cardText}>予約ページの URL は、管理者が確かめられます。</p>
                )}
                {linkAsked && link && !link.available ? (
                  <Notice tone="info" role="status">LINE 予約のページは、まだ使えません。使えるようになったら、ここからコピーして貼れます。</Notice>
                ) : null}
              </div>
              <div className={styles.card}>
                <p className={styles.cardTitle}>ボタンの見本と貼り付けるコード</p>
                <div className={styles.sampleRow}>
                  <span className={styles.lineButton} aria-hidden="true"><MessageCircle size={16} />LINE で予約する</span>
                  <span className={styles.cardText}>大きさ：標準</span>
                </div>
                {canManage ? (
                  <>
                    <code className={styles.code} title={link?.html}>{link?.html ?? (linkError || '読み込んでいます…')}</code>
                    <span className={styles.copyRow}>
                      <Button onClick={() => void copyText(link?.html ?? '', '貼り付けるコード')} disabled={!link}><Copy size={15} aria-hidden="true" />コードをコピー</Button>
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <section className={styles.sectionTight} aria-label="他のサイトの枠を閉じる知らせ">
            <SectionHeader
              title="他のサイトの枠を閉じる知らせ"
              help="知らせを出す媒体は、表の行の「…」から1つずつ選べます。下の切り替えは、予約を受ける媒体をまとめてオン・オフします。"
              helpLabel="他のサイトの枠を閉じる知らせの説明"
            />
            <div className={styles.band}>
              <Info size={16} aria-hidden="true" className={styles.bandIcon} />
              <span className={styles.bandText}>席の数（在庫）の自動調整はしません。LINE や電話で予約が入ったら、他のサイトの同じ時刻の枠を閉じる知らせを出します。</span>
            </div>
            <div className={styles.switchRow}>
              {/* 閲覧のみには押せる形のスイッチを置かない。オン・オフは札で見せる。 */}
              {canManage ? (
                <Toggle checked={closeOn} label="LINE・電話で予約が入ったら、他のサイトの枠を閉じる知らせを出す" onChange={(next) => setAllClose(next)} />
              ) : <StatusBadge tone={closeOn ? 'success' : 'neutral'}>{closeOn ? 'オン' : 'オフ'}</StatusBadge>}
              <span className={styles.switchText}>
                <span className={styles.switchTitle}>LINE・電話で予約が入ったら、他のサイトの枠を閉じる知らせを出す</span>
                <span className={styles.switchSub} title={closeTargets.length ? `対象：${closeTargets.join('・')}` : '対象の媒体はありません'}>ダッシュボードの上と「枠を閉じる知らせ」の一覧に出ます</span>
              </span>
            </div>
            <div className={styles.switchRow}>
              {/* 切り替える口が無い（取消・終了・日時変更では、いつも「もう開けてよい」を出す）。オンのまま押せない形。 */}
              {canManage ? <Toggle checked locked label="キャンセルで席が空いたら「もう開けてよい」を知らせる" /> : <StatusBadge tone="success">オン</StatusBadge>}
              <span className={styles.switchText}>
                <span className={styles.switchTitle}>キャンセルで席が空いたら「もう開けてよい」を知らせる</span>
              </span>
            </div>
            <div className={styles.targetRow}>
              <span className={styles.targetLabel}>知らせる相手</span>
              {/* 相手を選ぶ口が無い。今の決まり（当日の責任者、いなければ店長）を出すだけ。 */}
              <span className={styles.targetValue} title="当日の責任者に届きます。責任者が決まっていない日は店長に届きます">当日の責任者（いなければ店長）</span>
              <span className={styles.cardText}>管理画面とスタッフの LINE に届きます</span>
            </div>
          </section>
        </div>
        {canManage ? (
          <div className={styles.footer}>
            <StickyBar
              actions={(
                <>
                  <Button onClick={() => { if (saved) setRows(saved); setSaveError('') }} disabled={saving}>キャンセル</Button>
                  <Button variant="primary" onClick={() => void save()} busy={saving} busyLabel="保存中…" disabled={dirty.length === 0 || saving} title={dirty.length === 0 ? '変えた所がありません' : undefined}>
                    <Check size={15} aria-hidden="true" />保存する
                  </Button>
                </>
              )}
              status={dirty.length > 0 ? <span aria-live="polite">{`変えた媒体 ${dirty.length}件（まだ保存していません）`}</span> : undefined}
            />
          </div>
        ) : null}
      </PageFrame>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="予約サイト・グルメ媒体の変更"
        busy={saving}
        onCancel={() => { if (!saving) cancelLeave() }}
        onConfirm={() => { confirmLeave() }}
      />

      <Dialog
        open={!!editing}
        title={editing ? `${editing.name}の URL` : 'URL'}
        description="https:// で始まる URL を入れます。空にすると消えます。保存は画面の下の［保存する］で行います。"
        confirmLabel="変える"
        onConfirm={applyEdit}
        onCancel={() => setEditing(null)}
        error={editError || undefined}
      >
        <div className={styles.dialogFields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>店舗ページの URL</span>
            <TextField value={editPage} onChange={(event) => setEditPage(event.target.value)} placeholder="https://" inputMode="url" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>管理画面（ログイン）の URL</span>
            <TextField value={editLogin} onChange={(event) => setEditLogin(event.target.value)} placeholder="https://" inputMode="url" />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={adding}
        title="媒体を足す"
        description="予約を受けないグルメ媒体（口コミ・紹介のサイトなど）を足します。予約メールは取り込みません。足したら行の「…」から URL を入れます。"
        confirmLabel="足す"
        busy={addBusy}
        onConfirm={() => void addMedium()}
        onCancel={() => setAdding(false)}
        error={addError || undefined}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>媒体の名前</span>
          <TextField value={addName} onChange={(event) => setAddName(event.target.value)} placeholder="例：OZmall" maxLength={100} />
        </label>
      </Dialog>
    </>
  )
}
