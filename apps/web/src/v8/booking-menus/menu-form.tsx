'use client'

/**
 * ★V8「予約メニューを作る」（板 QqER7・競合時 v5L19Z）。
 *
 * 左に5つの段（中身・担当・きまり・受け方・受けたとき・設備・支払い）、
 * 右に本物そっくりのお客さまの予約画面。作っているメニューが写しの
 * 先頭に選ばれた状態で出るので、入力しながら見え方を確かめられる。
 *
 * `?menu=<id>` が付いていると編集になる。保存は v7 と同じ契約：
 *   作る … createMenu（何度押しても増えないよう試行ごとの一意キー）
 *        → 担当ごとに staff_menus を PUT → 設備を PUT
 *   直す … updateMenu（版つき PUT）→ 変わった担当だけ PUT → 設備を PUT
 * 409 は板 v5L19Z の帯を出し、「違いを比べる」「最新を読み込んで続ける」
 * 「比べてから保存」で扱う（いきなり上書きしない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import Combobox from '@/components/shared/combobox'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { GitCompare, Pencil, RefreshCw, Smartphone, TriangleAlert, Upload } from 'lucide-react'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { notifyToast } from '@/components/shared/toast'
import { useAccount } from '@/contexts/account-context'
import { useBookingEdit } from './lib/edit-permission'
import { classifyApiFailure } from '@/components/shared/api-error-message'
import { formatNumber } from '@/lib/format'
import {
  api,
  ApiError,
  bookingApi,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
  type BookingStaff,
  type StaffMenuMatrix,
} from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { bookingMenuBufferError, bookingMenuDurationError, bookingMenuError, bookingMenuNameError } from './lib/menu-validation'
import MenuVersionHistory from './menu-version-history'
import { LiffPhoneMenuStep } from './liff-phone'
import shell from './settings.module.css'
import styles from './menu-form.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

/** 作りかけ／直しかけのメニューを、写し側へ渡す形にする。 */
type DraftMenu = Pick<
  BookingMenu,
  'id' | 'name' | 'category_label' | 'description' | 'duration_minutes' | 'base_price' | 'price_mode' | 'sort_order' | 'is_active' | 'auto_tag_id'
>

function conflictTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 編集中身の読み込み待ちの骨組み（本物と同じ段の形。読み上げは呼び出し側の aria-busy で1回だけ）。 */
function MenuFormSkeleton() {
  return (
    <div aria-hidden="true">
      <header className={shell.boardHead} data-design="Head">
        <Skeleton width={64} height={16} />
        <Skeleton width={200} height={22} />
        <Skeleton width={260} height={14} />
      </header>
      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          {[0, 1, 2].map((section) => (
            <section key={section} className={shell.section}>
              <div className={shell.sectionHead}>
                <Skeleton width={120} height={18} />
              </div>
              <div className={styles.fieldGrid}>
                <Skeleton width="100%" height={32} />
                <Skeleton width="100%" height={32} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 札の並びの読み込み待ちの骨組み（担当・設備の本物と同じ高さの札3枚）。 */
function ChipRowSkeleton() {
  return (
    <span className={`${styles.chipRow} mt-3`} aria-hidden="true">
      <Skeleton width={120} height={32} />
      <Skeleton width={96} height={32} />
      <Skeleton width={136} height={32} />
    </span>
  )
}

function cutoffStoreLabel(settings: BookingSettings | null): string {
  if (!settings) return 'お店のきまり'
  return `お店のきまり（${settings.cutoffMinutesBefore / 60}時間前）`
}

function cancelStoreLabel(settings: BookingSettings | null): string {
  if (!settings) return 'お店のきまり'
  const minutes = settings.cancelDeadlineMinutesBefore
  if (minutes === 1440) return 'お店のきまり（前日まで）'
  return `お店のきまり（${minutes / 60}時間前）`
}

export default function MenuFormV8() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('menu')
  const { selectedAccountId, selectedAccount } = useAccount()
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  const canEdit = useBookingEdit('/booking/menus')

  /* ---- 読み込むデータ ---- */
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [menusStatus, setMenusStatus] = useState<LoadStatus>('loading')
  const [staff, setStaff] = useState<BookingStaff[]>([])
  const [staffStatus, setStaffStatus] = useState<LoadStatus>('loading')
  const [staffError, setStaffError] = useState<unknown>(null)
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [resources, setResources] = useState<BookingResource[]>([])
  const [resourcesStatus, setResourcesStatus] = useState<LoadStatus>('loading')
  const [bookingMileage, setBookingMileage] = useState<number | null>(null)
  const [mileageStatus, setMileageStatus] = useState<LoadStatus>('loading')

  /* ---- 編集対象 ---- */
  const [editTarget, setEditTarget] = useState<BookingMenu | null>(null)
  const [editStatus, setEditStatus] = useState<LoadStatus>(editId ? 'loading' : 'ready')
  const [editError, setEditError] = useState<string | null>(null)

  /* ---- 入力 ---- */
  const [name, setName] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [categoryNew, setCategoryNew] = useState('')
  const [categoryPicking, setCategoryPicking] = useState(false)
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [basePrice, setBasePrice] = useState('')
  const [concurrentCapacity, setConcurrentCapacity] = useState('1')
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState('0')
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [noAssign, setNoAssign] = useState(false)
  const [ownRules, setOwnRules] = useState(false)
  const [windowDays, setWindowDays] = useState('')
  const [cutoffHours, setCutoffHours] = useState('')
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState('')
  const [askQuestion, setAskQuestion] = useState(false)
  const [intakeQuestion, setIntakeQuestion] = useState('')
  const [autoTagId, setAutoTagId] = useState<string | null>(null)
  const [resourceIds, setResourceIds] = useState<Set<string>>(new Set())

  /* ---- 保存・競合 ---- */
  const [saving, setSaving] = useState<null | 'draft' | 'publish' | 'conflict'>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /* 欄を離れたときに出す1欄ずつの直し方（文は保存時と同じ）。 */
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; duration?: string; buffer?: string }>({})
  const [conflict, setConflict] = useState<{ name: string; author: string | null; at: string | null; version: number } | null>(null)
  const [comparing, setComparing] = useState(false)
  /** 作成済みなのに後工程が残っている（DEEP-16）。再押しても作り直さない。 */
  const [createdMenuNeedingFollowUp, setCreatedMenuNeedingFollowUp] = useState<{
    menuId: string
    remainingStaffIds: string[]
    resourcesPending: boolean
  } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const generationRef = useRef(0)
  /* 409 の帯。保存は下の帯から押すので、出たら帯まで戻して見せる（押した場所のままだと気づかない）。 */
  const conflictRef = useRef<HTMLDivElement | null>(null)
  /** 読み込み直後の入力の形。これと違ったら「直しかけ」とみなす（破棄確認用）。 */
  const baselineRef = useRef('')

  const fillFrom = useCallback((menu: BookingMenu, matrices: Record<string, StaffMenuMatrix[]>, staffList: BookingStaff[]) => {
    setName(menu.name)
    setCategoryLabel(menu.category_label ?? '')
    setCategoryPicking(false)
    setCategoryNew('')
    setDescription(menu.description ?? '')
    setDurationMinutes(String(menu.duration_minutes))
    setBasePrice(menu.price_mode === 'inquiry' ? '' : String(menu.base_price))
    setConcurrentCapacity(String(menu.concurrent_capacity ?? 1))
    setBufferAfterMinutes(String(menu.buffer_after_minutes ?? 0))
    const own = menu.booking_window_days != null || menu.cutoff_hours_before != null || menu.cancel_deadline_hours_before != null
    setOwnRules(own)
    setWindowDays(menu.booking_window_days != null ? String(menu.booking_window_days) : '')
    setCutoffHours(menu.cutoff_hours_before != null ? String(menu.cutoff_hours_before) : '')
    setCancelDeadlineHours(menu.cancel_deadline_hours_before != null ? String(menu.cancel_deadline_hours_before) : '')
    setAskQuestion(Boolean(menu.intake_question))
    setIntakeQuestion(menu.intake_question ?? '')
    setAutoTagId(menu.auto_tag_id)
    setResourceIds(new Set((menu.assigned_resources ?? []).map((item) => item.resourceId)))
    const ids = new Set<string>()
    for (const [staffId, matrix] of Object.entries(matrices)) {
      if (matrix.some((row) => row.menu_id === menu.id && row.is_offered)) ids.add(staffId)
    }
    setAssigned(ids)
    const optionalHit = [...ids].some((id) => staffList.find((person) => person.id === id)?.is_designation_optional === 1)
    setNoAssign(optionalHit)
    baselineRef.current = JSON.stringify([
      menu.name, menu.category_label ?? '', menu.description ?? '', String(menu.duration_minutes),
      menu.price_mode === 'inquiry' ? '' : String(menu.base_price), String(menu.concurrent_capacity ?? 1),
      String(menu.buffer_after_minutes ?? 0), own,
      // WEB064：入力欄と同じ文字の形でそろえる（数のままだと開いた直後から「直しかけ」になる）。
      menu.booking_window_days != null ? String(menu.booking_window_days) : '',
      menu.cutoff_hours_before != null ? String(menu.cutoff_hours_before) : '',
      menu.cancel_deadline_hours_before != null ? String(menu.cancel_deadline_hours_before) : '',
      Boolean(menu.intake_question), menu.intake_question ?? '', menu.auto_tag_id,
      [...ids].sort().join(','), [...(menu.assigned_resources ?? []).map((item) => item.resourceId)].sort().join(','),
      optionalHit,
    ])
  }, [])

  const loadAll = useCallback(async () => {
    if (!selectedAccountId) {
      setMenusStatus('ready')
      setStaffStatus('ready')
      setEditStatus('ready')
      setResourcesStatus('ready')
      return
    }
    const generation = ++generationRef.current
    const alive = () => generationRef.current === generation
    setMenusStatus('loading')
    setStaffStatus('loading')
    setStaffError(null)
    setEditStatus(editId ? 'loading' : 'ready')
    setEditError(null)
    setResourcesStatus('loading')

    const [menusResult, staffResult, settingsResult, resourcesResult, matricesResult] = await Promise.allSettled([
      bookingApi.listMenus(selectedAccountId),
      bookingApi.listStaff(selectedAccountId),
      bookingApi.getSettings(selectedAccountId),
      bookingApi.listResources(selectedAccountId),
      bookingApi.listStaffMenusBulk(selectedAccountId),
    ])
    if (!alive()) return

    const list = menusResult.status === 'fulfilled' ? (menusResult.value.menus ?? []) : []
    setMenus(list)
    setMenusStatus(menusResult.status === 'fulfilled' ? 'ready' : 'error')

    if (staffResult.status === 'fulfilled') {
      setStaff(staffResult.value.staff)
      setStaffStatus('ready')
    } else {
      setStaff([])
      setStaffStatus('error')
      setStaffError(staffResult.reason)
    }
    if (settingsResult.status === 'fulfilled' && settingsResult.value.success) {
      setSettings(settingsResult.value.data)
    } else {
      setSettings(null)
    }
    if (resourcesResult.status === 'fulfilled') {
      setResources(resourcesResult.value.data.resources)
      setResourcesStatus('ready')
    } else {
      setResourcesStatus('error')
    }

    if (editId) {
      const target = list.find((menu) => menu.id === editId) ?? null
      if (!target) {
        setEditStatus('error')
        setEditError(menusResult.status === 'fulfilled'
          ? 'このメニューは見つかりませんでした。消されたか、別のアカウントのものです。'
          : bookingErrorText(menusResult.reason, '読み込み'))
      } else {
        const matrices: Record<string, StaffMenuMatrix[]> = {}
        if (matricesResult.status === 'fulfilled') {
          for (const entry of matricesResult.value.staff) matrices[entry.staff_id] = entry.matrix
        }
        const staffList = staffResult.status === 'fulfilled' ? staffResult.value.staff : []
        setEditTarget(target)
        fillFrom(target, matrices, staffList)
        setEditStatus('ready')
      }
    }
  }, [selectedAccountId, editId, fillFrom])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  /* タグ候補（このアカウントの有効なものだけ）。失敗してもタグなし保存は止めない。 */
  const [tagStatus, setTagStatus] = useState<LoadStatus>('loading')
  useEffect(() => {
    let cancelled = false
    setTagStatus('loading')
    api.tags
      .list(selectedAccountId ? { accountId: selectedAccountId } : undefined)
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setTags(res.data)
          setTagStatus('ready')
        } else {
          setTagStatus('error')
        }
      })
      .catch(() => { if (!cancelled) setTagStatus('error') })
    return () => { cancelled = true }
  }, [selectedAccountId])


  /* 予約時のマイル（お店全体の付与ルールの読み出しだけ。メニューごとの口は無い） */
  useEffect(() => {
    let alive = true
    api.mileage.rules()
      .then((response) => {
        if (!alive) return
        if (!response.success) { setMileageStatus('error'); return }
        const rule = response.data.find((item) => item.eventType === 'booking_created' && item.isActive)
        setBookingMileage(rule?.amount ?? null)
        setMileageStatus('ready')
      })
      .catch(() => { if (alive) { setBookingMileage(null); setMileageStatus('error') } })
    return () => { alive = false }
  }, [])

  /* アカウントを変えたら別の作成試行にする（R535）。前アカウントの選択も残さない。 */
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID())
    setCreatedMenuNeedingFollowUp(null)
    setConflict(null)
    setComparing(false)
    setAssigned(new Set())
    setResourceIds(new Set())
    setAutoTagId(null)
    setNoAssign(false)
  }, [selectedAccountId])

  /* ---- 導出 ---- */
  const categoryOptions = useMemo(() => {
    const existing = [...new Set(menus.map((menu) => menu.category_label).filter((c): c is string => Boolean(c)))]
    return [
      { value: '', label: '分類なし' },
      ...existing.map((label) => ({ value: label, label })),
      { value: '__new__', label: '新しい分類を入力…' },
    ]
  }, [menus])

  /* 一覧の口はアカウントで絞って返し、lineAccountId は定義詳細でしか返らない。
     値が無いタグはこのアカウントのものとして扱う（以前は全部はじいて「タグがありません」になっていた）。 */
  const tagCandidates = tags.filter(
    (tag) => (tag.lineAccountId == null || tag.lineAccountId === selectedAccountId) && tag.status !== 'archived',
  )

  const assignedIds = [...assigned].filter((id) => staff.some((person) => person.id === id))
  const activeResources = resources.filter((item) => item.isActive)

  const effectiveCategory = categoryPicking ? categoryNew.trim() : categoryLabel.trim()
  const draftMenu: DraftMenu = {
    id: editTarget?.id ?? '__draft__',
    name: name.trim() || 'メニュー名',
    category_label: effectiveCategory || null,
    description: description.trim() || null,
    duration_minutes: Number(durationMinutes) || 0,
    base_price: Number(basePrice) || 0,
    price_mode: basePrice.trim() === '' ? 'inquiry' : Number(basePrice) === 0 ? 'free' : 'fixed',
    sort_order: -1,
    is_active: 1,
    auto_tag_id: autoTagId,
  }

  /*
   * 直しかけ判定：読み込んだ時点（作成なら初期値）と違ったら確認を挟む。
   * baseline は fillFrom で版ごと取り直す。
   */
  const currentSignature = JSON.stringify([
    name, effectiveCategory, description, durationMinutes, basePrice, concurrentCapacity,
    bufferAfterMinutes, ownRules, windowDays, cutoffHours, cancelDeadlineHours,
    askQuestion, intakeQuestion, autoTagId,
    [...assigned].sort().join(','), [...resourceIds].sort().join(','), noAssign,
  ])
  const dirty = baselineRef.current !== '' && baselineRef.current !== currentSignature ||
    (baselineRef.current === '' && Boolean(
      name || effectiveCategory || description || durationMinutes !== '60' ||
      bufferAfterMinutes !== '0' || basePrice || concurrentCapacity !== '1' ||
      windowDays || cutoffHours || cancelDeadlineHours || intakeQuestion ||
      assigned.size > 0 || autoTagId || resourceIds.size > 0
    ))
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  usePageTitle(editTarget ? '予約メニューを直す' : '予約メニューを作る')
  usePageCrumbs([
    { label: '予約', href: '/booking/bookings' },
    { label: '予約設定', href: '/booking/menus' },
    { label: editTarget ? 'メニューを直す' : 'メニューを作る' },
  ])

  function toggleAssigned(id: string) {
    setAssigned((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 「指名なし」でも受ける … このメニューを「指名なし枠に入る」スタッフへ
   * 割り当てることのまとめ操作。API にメニュー側の口は無いので、
   * is_designation_optional が立つ担当のチェックを揃える形で表す。
   */
  function toggleNoAssign(next: boolean) {
    setNoAssign(next)
    setAssigned((current) => {
      const updated = new Set(current)
      for (const person of staff) {
        if (!person.is_active || person.is_designation_optional !== 1) continue
        if (next) updated.add(person.id)
        else updated.delete(person.id)
      }
      return updated
    })
  }

  function toggleResource(id: string) {
    setResourceIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function validate(): string | null {
    if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
    if (staffStatus === 'loading') return '担当スタッフを読み込んでいます。読み込みが終わってから保存してください'
    if (staffStatus === 'error') return '担当スタッフを読み込めませんでした。読み直してから保存してください'
    return bookingMenuError({
      name,
      durationMinutes,
      bufferAfterMinutes,
      sortOrder: 0,
      assignedStaffCount: assignedIds.length,
    })
  }

  /** 担当の割り当てを staff_menus へ流す。失敗した担当のIDを返す。 */
  async function writeStaffAssignments(menuId: string, staffIds: string[]): Promise<string[]> {
    const matrixByStaff = new Map<string, StaffMenuMatrix[]>()
    const failed: string[] = []
    try {
      const bulk = await bookingApi.listStaffMenusBulk(selectedAccountId!)
      for (const entry of bulk.staff) matrixByStaff.set(entry.staff_id, entry.matrix)
    } catch {
      await Promise.all(
        staffIds.map(async (staffId) => {
          try {
            const { matrix } = await bookingApi.getStaffMenus(selectedAccountId!, staffId)
            matrixByStaff.set(staffId, matrix)
          } catch {
            failed.push(staffId)
          }
        }),
      )
    }
    await Promise.all(
      staffIds.filter((id) => !failed.includes(id)).map(async (staffId) => {
        try {
          const matrix = matrixByStaff.get(staffId) ?? []
          const known = matrix.some((row) => row.menu_id === menuId)
          await bookingApi.putStaffMenus(
            selectedAccountId!,
            staffId,
            matrix.map((row) => ({
              menu_id: row.menu_id,
              is_offered: row.menu_id === menuId ? true : Boolean(row.is_offered),
              override_duration_minutes: row.override_duration_minutes ?? null,
              override_price: row.override_price ?? null,
            })),
          )
          if (!known) {
            /* 行列に無いメニュー行は Worker 側が足す。ここでは送るだけ。 */
          }
        } catch {
          failed.push(staffId)
        }
      }),
    )
    return failed
  }

  /** 編集時: いままで付いていた担当でチェックを外した人の is_offered を落とす。 */
  async function removeStaffAssignments(menuId: string): Promise<string[]> {
    const removed = [...(editTarget?.assigned_staff ?? []).map((person) => person.id)]
      .filter((id) => !assigned.has(id) && staff.some((person) => person.id === id))
    const failed: string[] = []
    await Promise.all(removed.map(async (staffId) => {
      try {
        const { matrix } = await bookingApi.getStaffMenus(selectedAccountId!, staffId)
        await bookingApi.putStaffMenus(
          selectedAccountId!,
          staffId,
          matrix.map((row) => ({
            menu_id: row.menu_id,
            is_offered: row.menu_id === menuId ? false : Boolean(row.is_offered),
            override_duration_minutes: row.override_duration_minutes ?? null,
            override_price: row.override_price ?? null,
          })),
        )
      } catch {
        failed.push(staffId)
      }
    }))
    return failed
  }

  async function writeResources(menuId: string, expectedVersion: number): Promise<number> {
    const selected = [...resourceIds].map((resourceId) => ({ resourceId, quantity: 1 }))
    const before = (editTarget?.assigned_resources ?? [])
      .map((item) => item.resourceId)
      .sort()
      .join(',')
    const after = [...resourceIds].sort().join(',')
    if (before === after && editTarget) return expectedVersion
    const response = await bookingApi.saveMenuResources(selectedAccountId!, menuId, {
      expectedVersion,
      resources: selected,
    })
    return response.data.version
  }

  function menuBody(publish: boolean): Partial<BookingMenu> {
    return {
      name: name.trim(),
      category_label: effectiveCategory || null,
      description: description.trim() || null,
      duration_minutes: Number(durationMinutes),
      buffer_after_minutes: Number(bufferAfterMinutes) || 0,
      base_price: Number(basePrice) || 0,
      price_mode: basePrice.trim() === '' ? 'inquiry' : Number(basePrice) === 0 ? 'free' : 'fixed',
      concurrent_capacity: Number(concurrentCapacity) || 1,
      booking_window_days: ownRules && windowDays ? Number(windowDays) : null,
      cutoff_hours_before: ownRules && cutoffHours ? Number(cutoffHours) : null,
      cancel_deadline_hours_before: ownRules && cancelDeadlineHours ? Number(cancelDeadlineHours) : null,
      intake_question: askQuestion ? intakeQuestion.trim() || null : null,
      auto_tag_id: autoTagId,
      is_active: publish ? 1 : 0,
    }
  }

  useEffect(() => {
    if (conflict) conflictRef.current?.scrollIntoView?.({ block: 'center' })
  }, [conflict])

  /** 409のとき：最新の版と直した人を読み、帯に出す。 */
  async function openConflict(menuId: string) {
    try {
      const [menusNow, versionsNow] = await Promise.all([
        bookingApi.listMenus(selectedAccountId!),
        bookingApi.listMenuVersions(selectedAccountId!, menuId),
      ])
      const latestMenu = menusNow.menus.find((menu) => menu.id === menuId) ?? null
      const latest = versionsNow.versions?.[0]
      setConflict({
        name: latestMenu?.name ?? name.trim() ?? 'メニュー',
        author: latest?.author ?? null,
        at: latest?.at ?? null,
        version: latestMenu?.version ?? 0,
      })
    } catch {
      setConflict({ name: name.trim() || 'メニュー', author: null, at: null, version: 0 })
    }
  }

  async function save(publish: boolean, overwrite = false) {
    if (!selectedAccountId || saving) return
    setSaveError(null)
    const validationError = validate()
    if (validationError) {
      setSaveError(validationError)
      const nameError = bookingMenuNameError(name)
      const durationError = bookingMenuDurationError(durationMinutes)
      const bufferError = bookingMenuBufferError(bufferAfterMinutes)
      setFieldErrors({
        ...(nameError !== null ? { name: nameError } : {}),
        ...(durationError !== null ? { duration: durationError } : {}),
        ...(bufferError !== null ? { buffer: bufferError } : {}),
      })
      return
    }
    setFieldErrors({})
    setSaving(conflict ? 'conflict' : publish ? 'publish' : 'draft')
    try {
      let menuId: string | null = editTarget?.id ?? createdMenuNeedingFollowUp?.menuId ?? null
      let version = 0

      if (menuId == null) {
        const res = await bookingApi.createMenu(selectedAccountId, menuBody(publish), idempotencyKey)
        menuId = res.id
        setCreatedMenuNeedingFollowUp({ menuId, remainingStaffIds: assignedIds, resourcesPending: resourceIds.size > 0 })
      } else if (createdMenuNeedingFollowUp && !editTarget) {
        /*
         * WEB062：作れたメニューの続き（担当・設備）だけをやり直す。メニューそのものは
         * 作ったとき（公開・下書きの選択も）のまま。版の無い「直す」へ進めて 409 にしたり、
         * 公開を黙って下書きへ戻したりしない。版は下でいまの版を取り直す。
         */
      } else {
        /* 編集。競合からの上書きのときは読み直した最新版を使う。 */
        const expectedVersion = overwrite && conflict ? conflict.version : editTarget?.version
        if (typeof expectedVersion !== 'number' || expectedVersion < 1) {
          throw new ApiError(409, 'version_conflict', 'version_conflict')
        }
        try {
          const res = await bookingApi.updateMenu(selectedAccountId, menuId, expectedVersion, menuBody(editTarget?.is_active === 1))
          version = res.version
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await openConflict(menuId)
            setSaving(null)
            return
          }
          throw e
        }
      }

      /* 作成直後は版を取り直す（createMenu は id しか返さない）。 */
      if (!version) {
        const fresh = await bookingApi.listMenus(selectedAccountId)
        version = fresh.menus.find((menu) => menu.id === menuId)?.version ?? 0
      }

      /* 担当。作成済みの再開なら残っている人だけ。 */
      const pendingStaffIds = createdMenuNeedingFollowUp
        ? createdMenuNeedingFollowUp.remainingStaffIds.filter((id) => assigned.has(id))
        : assignedIds
      const failedStaff = await writeStaffAssignments(menuId, pendingStaffIds)
      if (editTarget && !createdMenuNeedingFollowUp) {
        failedStaff.push(...await removeStaffAssignments(menuId))
      }

      /* 設備（選んだときだけ）。 */
      // WEB063：設備は「選んだときだけ」ではなく、前と変わったときに保存する（全部外したときも）。
      const resourcesChanged = editTarget
        ? [...(editTarget.assigned_resources ?? []).map((item) => item.resourceId)].sort().join(',') !== [...resourceIds].sort().join(',')
        : resourceIds.size > 0
      let resourcesPending = createdMenuNeedingFollowUp?.resourcesPending ?? resourcesChanged
      if (resourcesPending && version >= 1) {
        try {
          version = await writeResources(menuId, version)
          resourcesPending = false
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            const fresh = await bookingApi.listMenus(selectedAccountId)
            version = fresh.menus.find((menu) => menu.id === menuId)?.version ?? version
            try {
              version = await writeResources(menuId, version)
              resourcesPending = false
            } catch {
              /* 残ったまま帯に出す */
            }
          }
        }
      }

      if (failedStaff.length > 0 || resourcesPending) {
        setCreatedMenuNeedingFollowUp({ menuId, remainingStaffIds: failedStaff, resourcesPending })
        throw new Error('メニューは保存されましたが、一部の担当・設備を保存できませんでした。もう一度押すと残りだけをやり直します。')
      }
      setCreatedMenuNeedingFollowUp(null)
      notifyToast(editTarget ? 'メニューを保存しました' : publish ? 'メニューを公開しました' : '下書きを保存しました')
      router.push('/booking/menus')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'tag_not_found') {
        setSaveError('選んだタグは削除されたため保存できませんでした。タグを選び直してください。')
      } else if (e instanceof ApiError && e.status === 409) {
        if (editTarget ?? createdMenuNeedingFollowUp) {
          await openConflict(editTarget?.id ?? createdMenuNeedingFollowUp!.menuId)
        } else {
          setSaveError(bookingErrorText(e, '保存'))
        }
      } else {
        setSaveError(e instanceof Error ? e.message : bookingErrorText(e, '保存'))
      }
    } finally {
      setSaving(null)
    }
  }

  /** 「最新を読み込んで続ける」：最新の中身で入力を置き直す。 */
  async function reloadLatest() {
    const menuId = editTarget?.id ?? createdMenuNeedingFollowUp?.menuId
    if (!menuId || !selectedAccountId) return
    try {
      const fresh = await bookingApi.listMenus(selectedAccountId)
      const target = fresh.menus.find((menu) => menu.id === menuId)
      if (!target) {
        setEditError('このメニューは見つかりませんでした。消されたか、別のアカウントのものです。')
        return
      }
      const bulk = await bookingApi.listStaffMenusBulk(selectedAccountId).catch(() => null)
      const matrices: Record<string, StaffMenuMatrix[]> = {}
      if (bulk) for (const entry of bulk.staff) matrices[entry.staff_id] = entry.matrix
      setEditTarget(target)
      fillFrom(target, matrices, staff)
      setConflict(null)
      setSaveError(null)
      notifyToast('最新の内容を読み込みました')
    } catch (e) {
      setSaveError(bookingErrorText(e, '読み込み'))
    }
  }

  if (!canEdit) {
    return (
      <div className={shell.shell} data-design-node="QqER7">
        <div className="mx-auto max-w-2xl p-6">
          <ListState
            kind="error"
            title="予約メニューの変更権限がありません"
            description="メニューの作成・変更は、予約メニューの権限を持つログインユーザーだけが実行できます。管理者へ権限の確認を依頼してください。"
          />
        </div>
      </div>
    )
  }

  if (editId && editStatus === 'loading') {
    return (
      <div className={shell.shell} data-design-node="QqER7" aria-busy="true">
        <span className="sr-only" role="status">メニューを読み込んでいます</span>
        <DelayedSkeleton loading skeleton={<MenuFormSkeleton />} />
      </div>
    )
  }
  if (editId && editStatus === 'error') {
    return (
      <div className={shell.shell} data-design-node="QqER7">
        <div className="p-10">
          <ListState kind="error" description={editError ?? '読み込めませんでした。'} onRetry={() => void loadAll()} />
        </div>
      </div>
    )
  }

  const primaryLabel = conflict
    ? '比べてから保存'
    : createdMenuNeedingFollowUp
      ? '残りの設定をやり直す'
      : editTarget
        ? '変更を保存する'
        : '保存して公開'

  const checkMark = (
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 4l2.5 2.5L9 1" /></svg>
  )

  return (
    <div className={shell.shell} data-design-node="QqER7">
      <header className={styles.head} data-design="Head">
        <h1 className={shell.headTitle}>{editTarget ? '予約メニューを直す' : '予約メニューを作る'}</h1>
        <p className={shell.headNote}>
          {editTarget ? '保存すると、お客さまの画面にすぐ出ます' : 'まだお客さまの画面には出ていません'}
        </p>
      </header>

      {conflict && (
        <div ref={conflictRef} className={styles.conflictRow} data-design="Bar" data-design-node="v5L19Z">
          <div className={styles.conflictBand} role="alert">
            <TriangleAlert size={18} className={styles.conflictIcon} aria-hidden="true" />
            <div className={styles.conflictText}>
              <strong>
                {`${conflict.author ? `${conflict.author}さんが` : 'ほかの人が'}${conflict.at ? ` ${conflictTime(conflict.at)} に` : ''}メニュー「${conflict.name}」を保存しました`}
              </strong>
              <p>
                {`あなたが直した所はまだ保存されていません。このまま保存すると、${conflict.author ? `${conflict.author}さん` : 'ほかの人'}の変更が消えます。`}
              </p>
            </div>
            <Button onClick={() => setComparing(true)}><GitCompare size={15} aria-hidden="true" />違いを比べる</Button>
            <Button variant="primary" onClick={() => void reloadLatest()}><RefreshCw size={15} aria-hidden="true" />最新を読み込んで続ける</Button>
          </div>
        </div>
      )}

      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          {/* ① メニューの中身 */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>メニューの中身</h2>
            </div>
            <div className={styles.nameRow}>
              <label className={styles.field}>
                <span className={styles.label}>メニュー名</span>
                <input
                  className={styles.input}
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (fieldErrors.name !== undefined) {
                      setFieldErrors((previous) => ({ ...previous, name: bookingMenuNameError(e.target.value) ?? undefined }))
                    }
                  }}
                  onBlur={() => {
                    setFieldErrors((previous) => ({ ...previous, name: bookingMenuNameError(name) ?? undefined }))
                  }}
                  placeholder="例: トリミング（小型犬）"
                  aria-invalid={fieldErrors.name !== undefined}
                />
                {fieldErrors.name !== undefined ? (
                  <span className={styles.fieldError} role="alert">{fieldErrors.name}</span>
                ) : null}
              </label>
              <span className={`${styles.field} ${styles.categoryField}`}>
                <span className={styles.labelSmall}>分類</span>
                <Select
                  size="full"
                  aria-label="分類"
                  value={categoryPicking ? '__new__' : categoryLabel}
                  onChange={(value) => {
                    if (value === '__new__') {
                      setCategoryPicking(true)
                      setCategoryNew('')
                    } else {
                      setCategoryPicking(false)
                      setCategoryLabel(value)
                    }
                  }}
                  options={categoryOptions}
                />
                {categoryPicking && (
                  <input
                    className={styles.input}
                    type="text"
                    value={categoryNew}
                    onChange={(e) => setCategoryNew(e.target.value)}
                    placeholder="新しい分類の名前（例: トリミング）"
                    aria-label="新しい分類の名前"
                  />
                )}
              </span>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>説明（お客さまに見えます）<span className={styles.optional}>任意</span></span>
              <input
                className={styles.input}
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例: シャンプー・カット・爪切り"
              />
            </label>
            {/* 絵 QqER7：見出しの段と欄の段を分けて3列に並べる。 */}
            <div className={styles.grid3}>
              <span className={styles.labelSmall}>かかる時間</span>
              <span className={styles.labelSmall}>金額（空なら「お問い合わせ」）</span>
              <span className={styles.labelSmall}>予約したときのマイル</span>
              <span className={styles.unitField}>
                <input
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => {
                    setDurationMinutes(e.target.value)
                    if (fieldErrors.duration !== undefined) {
                      setFieldErrors((previous) => ({ ...previous, duration: bookingMenuDurationError(e.target.value) ?? undefined }))
                    }
                  }}
                  onBlur={() => {
                    setFieldErrors((previous) => ({ ...previous, duration: bookingMenuDurationError(durationMinutes) ?? undefined }))
                  }}
                  aria-label="かかる時間（分）"
                  aria-invalid={fieldErrors.duration !== undefined}
                />
                <span className={styles.unitSuffix}>分</span>
              </span>
              <span className={styles.unitField}>
                <span className={styles.unitPrefix}>¥</span>
                <input
                  type="number"
                  min={0}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  placeholder="8,400"
                  aria-label="金額（円）"
                />
              </span>
              <span className={styles.unitField}>
                <input
                  type="text"
                  value={
                    mileageStatus === 'loading' ? '…'
                      : mileageStatus === 'error' ? '未取得'
                      : bookingMileage === null ? '未設定'
                      : formatNumber(bookingMileage)
                  }
                  disabled
                  aria-label="予約したときのマイル（お店全体の設定）"
                />
                <span className={styles.unitSuffix}>マイル</span>
              </span>
            </div>
            {fieldErrors.duration !== undefined ? (
              <span className={styles.fieldError} role="alert">{fieldErrors.duration}</span>
            ) : null}
          </section>

          {/* ② 担当スタッフ */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>担当スタッフ</h2>
              <span className={shell.sectionDesc}>1人も選ばないと、お客さまの画面に枠が出ません</span>
            </div>
            {staffStatus === 'loading' ? (
              <span className="inline-block" aria-busy="true">
                <span className="sr-only">担当を読み込んでいます</span>
                <DelayedSkeleton loading skeleton={<ChipRowSkeleton />} />
              </span>
            ) : staffStatus === 'error' ? (
              <div className="space-y-2">
                <p className="text-ink-faint text-sm">
                  {classifyApiFailure(staffError) === 'forbidden'
                    ? '担当スタッフを見る権限がありません。オーナーか管理者に追加を依頼してください。'
                    : '担当を読み込めませんでした。入力はそのまま残っています。'}
                </p>
                {classifyApiFailure(staffError) !== 'forbidden' && selectedAccountId && (
                  <Button variant="secondary" size="compact" onClick={() => void loadAll()}>
                    担当をもう一度読み込む
                  </Button>
                )}
              </div>
            ) : staff.length === 0 ? (
              <p className="text-ink-faint text-sm">
                まだスタッフが登録されていません。先に予約設定の「担当スタッフ」から登録してください。
              </p>
            ) : (
              <>
                <div className={styles.staffRow}>
                  {staff.filter((person) => person.is_active).map((person) => {
                    const on = assigned.has(person.id)
                    // 絵 QqER7：トリマーは名前だけ、それ以外は（役割）を付ける。
                    const label = `${person.display_name || person.name}${person.role && person.role !== 'トリマー' ? `（${person.role}）` : ''}`
                    return (
                      <button
                        key={person.id}
                        type="button"
                        aria-pressed={on}
                        title={person.role ? `${person.display_name || person.name}（${person.role}）` : undefined}
                        className={`${styles.staffChip} ${on ? styles.staffChipOn : ''}`}
                        onClick={() => toggleAssigned(person.id)}
                      >
                        <span className={styles.chipBox} aria-hidden="true">{checkMark}</span>
                        {label}
                      </button>
                    )
                  })}
                </div>
                <div className={styles.toggleLine}>
                  <span className={styles.toggleLineLabel}>「指名なし」でも受ける</span>
                  <Toggle
                    label="「指名なし」でも受ける"
                    checked={noAssign}
                    onChange={toggleNoAssign}
                  />
                </div>
              </>
            )}
          </section>

          {/* ③ 予約のきまり */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>予約のきまり</h2>
              <span className={shell.sectionDesc}>空ならお店全体のきまり（予約のルール）を使います</span>
            </div>
            {ownRules ? (
              <>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>先の予約が取れる範囲</span>
                  <span className={`${styles.ruleValue} ${styles.ruleOwn}`}>
                    <input type="number" min={1} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} aria-label="先の予約が取れる範囲（日）" />
                    <span className={styles.unitSuffix}>日先まで</span>
                  </span>
                </div>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>受付の締め切り</span>
                  <span className={`${styles.ruleValue} ${styles.ruleOwn}`}>
                    <input type="number" min={1} value={cutoffHours} onChange={(e) => setCutoffHours(e.target.value)} aria-label="受付の締め切り（時間前）" />
                    <span className={styles.unitSuffix}>時間前</span>
                  </span>
                </div>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>キャンセルの期限</span>
                  <span className={`${styles.ruleValue} ${styles.ruleOwn}`}>
                    <input type="number" min={1} value={cancelDeadlineHours} onChange={(e) => setCancelDeadlineHours(e.target.value)} aria-label="キャンセルの期限（時間前）" />
                    <span className={styles.unitSuffix}>時間前</span>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>先の予約が取れる範囲</span>
                  <span className={styles.ruleValue}>
                    {settings ? `お店のきまり（${settings.bookingWindowDays}日先まで）` : 'お店のきまり'}
                  </span>
                </div>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>受付の締め切り</span>
                  <span className={styles.ruleValue}>{cutoffStoreLabel(settings)}</span>
                </div>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleLabel}>キャンセルの期限</span>
                  <span className={styles.ruleValue}>{cancelStoreLabel(settings)}</span>
                </div>
              </>
            )}
            <div className={styles.changeRow}>
              <button type="button" className={styles.changeLink} onClick={() => setOwnRules((v) => !v)}>
                {ownRules ? 'お店のきまりに戻す' : <><Pencil size={15} aria-hidden="true" />このメニューだけ変える</>}
              </button>
            </div>
          </section>

          {/* ④ そのほか（受け方・予約を受けたとき・設備）と お支払い。絵 QqER7 は灰の段に白い小段を積む。 */}
          <section className={`${shell.section} ${styles.moreSection}`}>
            <div className={styles.subSection}>
              <h2 className={styles.subTitle}>受け方</h2>
              <div className={styles.fieldStack}>
                <label className={styles.field}>
                  <span className={styles.label}>同時に受けられる件数</span>
                  <span className={styles.unitField}>
                    <input
                      type="number"
                      min={1}
                      value={concurrentCapacity}
                      onChange={(e) => setConcurrentCapacity(e.target.value)}
                      aria-label="同時に受けられる件数"
                    />
                    <span className={styles.unitSuffix}>件</span>
                  </span>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>後の空き時間（片付け・移動）</span>
                  <span className={styles.unitField}>
                    <input
                      type="number"
                      min={0}
                      value={bufferAfterMinutes}
                      onChange={(e) => {
                        setBufferAfterMinutes(e.target.value)
                        if (fieldErrors.buffer !== undefined) {
                          setFieldErrors((previous) => ({ ...previous, buffer: bookingMenuBufferError(e.target.value) ?? undefined }))
                        }
                      }}
                      onBlur={() => {
                        setFieldErrors((previous) => ({ ...previous, buffer: bookingMenuBufferError(bufferAfterMinutes) ?? undefined }))
                      }}
                      aria-label="後の空き時間（分）"
                      aria-invalid={fieldErrors.buffer !== undefined}
                    />
                    <span className={styles.unitSuffix}>分</span>
                  </span>
                  {fieldErrors.buffer !== undefined ? (
                    <span className={styles.fieldError} role="alert">{fieldErrors.buffer}</span>
                  ) : null}
                </label>
              </div>
            </div>

            <div className={styles.subSection}>
              <h2 className={styles.subTitle}>予約を受けたときにすること</h2>
              {tagStatus === 'loading' ? (
                <span className="inline-block w-full" aria-busy="true">
                  <span className="sr-only">タグを読み込んでいます</span>
                  <DelayedSkeleton loading skeleton={<Skeleton width="100%" height={36} />} />
                </span>
              ) : tagStatus === 'error' ? (
                <p className="text-ink-faint text-sm">タグを読み込めませんでした。タグなしで保存できます。</p>
              ) : tagCandidates.length === 0 ? (
                <p className="text-ink-faint text-sm">このアカウントに使えるタグがありません。タグなしで保存できます。</p>
              ) : (
                /* 打って絞り込める1つ選び（タグが多いアカウントでも探せる）。 */
                <Combobox
                  aria-label="予約後に付けるタグ"
                  value={autoTagId ?? ''}
                  onChange={(value) => setAutoTagId(value === '' ? null : value)}
                  placeholder="付けるタグ：なし"
                  /* 「なし」は候補に入れず、空のときの見出し（placeholder）と × で表す。 */
                  options={tagCandidates.map((tag) => ({ value: tag.id, label: `付けるタグ：${tag.name}` }))}
                />
              )}
              <div className={styles.toggleLineLead}>
                <Toggle
                  label="予約するときに質問を出す"
                  checked={askQuestion}
                  onChange={setAskQuestion}
                />
                <span className={styles.toggleLineLabel}>予約するときに質問を出す</span>
              </div>
              {askQuestion && (
                <label className={styles.field}>
                  <span className={styles.label}>質問文</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={intakeQuestion}
                    onChange={(e) => setIntakeQuestion(e.target.value)}
                    placeholder="例: 気になるところ・アレルギーがあれば教えてください"
                    maxLength={200}
                  />
                </label>
              )}
            </div>

            <div className={styles.subSection}>
              <h2 className={styles.subTitle}>使う設備</h2>
              {resourcesStatus === 'loading' ? (
                <span className="inline-block" aria-busy="true">
                  <span className="sr-only">設備を読み込んでいます</span>
                  <DelayedSkeleton loading skeleton={<ChipRowSkeleton />} />
                </span>
              ) : resourcesStatus === 'error' ? (
                <p className="text-ink-faint text-sm">設備を読み込めませんでした。選ばずに保存できます。</p>
              ) : activeResources.length === 0 ? (
                <p className="text-ink-faint text-sm">使える設備はまだありません。受付枠の設備から登録できます。</p>
              ) : (
                <div className={styles.checkRow}>
                  {activeResources.map((item) => {
                    const on = resourceIds.has(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={on}
                        className={`${styles.check} ${on ? styles.checkOn : ''}`}
                        onClick={() => toggleResource(item.id)}
                      >
                        <span className={styles.checkBox} aria-hidden="true">{checkMark}</span>
                        {item.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className={styles.payHead}>
              <h2 className={shell.sectionTitle}>お支払い</h2>
              <StatusBadge tone="warning" size="compact">お店で払うのみ</StatusBadge>
            </div>
            <p className={shell.sectionDesc}>決済サービスをつなぐと選べるようになります。いまは「お店で払う」だけです。</p>
            <div className={styles.payRow} role="radiogroup" aria-label="お支払い方法">
              <span className={`${styles.payOption} ${styles.payOptionOn}`} role="radio" aria-checked="true">
                <span className={styles.payDot} aria-hidden="true" />お店で払う
              </span>
              <span className={styles.payOption} role="radio" aria-checked="false" aria-disabled="true" title="決済サービスをつなぐと選べます">
                <span className={styles.payDot} aria-hidden="true" />オンラインで先払い
              </span>
              <span className={styles.payOption} role="radio" aria-checked="false" aria-disabled="true" title="決済サービスをつなぐと選べます">
                <span className={styles.payDot} aria-hidden="true" />どちらでも
              </span>
            </div>
          </section>

          {saveError && (
            <p className={styles.saveError} role="alert">{saveError}</p>
          )}
          {createdMenuNeedingFollowUp && !saveError && (
            <p className={styles.saveNote}>
              メニューは保存済みです。もう一度押しても新しいメニューは増えません。
            </p>
          )}
        </div>

        <aside className={shell.side} data-design="Side">
          <div className={shell.sideActions}>
            {previewUrl ? <Button href={previewUrl}><Smartphone size={15} aria-hidden="true" />お客さまに見える画面を確かめる</Button> : null}
          </div>
          <p className={shell.sideTitle}>お客さまの予約画面</p>
          <div className={shell.sidePhone}>
            <LiffPhoneMenuStep
              menus={menus.filter((menu) => menu.id !== editTarget?.id)}
              draft={draftMenu}
              status={menusStatus}
            />
          </div>
          <p className={shell.sideLineLink}>
            {previewUrl
              ? <a href={previewUrl} target="_blank" rel="noreferrer">実際の画面で確かめる ↗</a>
              : 'このアカウントには予約画面のURLがまだありません'}
          </p>
        </aside>
      </div>

      {/* 下の帯（追従・常に画面の下）。キャンセル・下書き・保存は中央（絵 QqER7・v5L19Z）。 */}
      <div className={shell.saveBarWrap} data-design="Savebar">
        <StickyBar
          status={conflict ? 'ほかの人の変更を確かめてから保存してください' : undefined}
          actions={(
            <>
              <Button onClick={() => router.push('/booking/menus')}>キャンセル</Button>
              {!editTarget && (
                <Button
                  disabled={saving !== null}
                  busy={saving === 'draft'}
                  onClick={() => void save(false)}
                >
                  下書きを保存
                </Button>
              )}
              <Button
                variant="primary"
                disabled={saving !== null}
                busy={saving !== null}
                onClick={() => void save(true, Boolean(conflict))}
              >
                <Upload size={15} aria-hidden="true" />{primaryLabel}
              </Button>
            </>
          )}
        />
      </div>

      {comparing && (editTarget ?? createdMenuNeedingFollowUp) && (
        <MenuVersionHistory
          menuId={editTarget?.id ?? createdMenuNeedingFollowUp!.menuId}
          menuName={conflict?.name ?? name}
          currentVersion={conflict?.version ?? editTarget?.version ?? 0}
          accountId={selectedAccountId!}
          canRevert={false}
          onReverted={() => void reloadLatest()}
          onClose={() => setComparing(false)}
        />
      )}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject={editTarget ? 'メニューの変更' : '入力したメニュー'} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

function bookingErrorText(error: unknown, action: '読み込み' | '保存'): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return `予約メニューを${action}する権限がありません。`
    if (error.status === 409) return `ほかの変更と重なったため、予約メニューを${action}できませんでした。`
  }
  return `予約メニューを${action}できませんでした。通信状態を確認して、もう一度お試しください。`
}
