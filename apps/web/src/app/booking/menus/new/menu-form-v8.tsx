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
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import Select from '@/components/shared/select'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import ListState from '@/components/shared/list-state'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { notifyToast } from '@/components/shared/toast'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature } from '@/lib/staff-capability'
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
import { bookingMenuError } from '../menu-validation'
import MenuVersionHistory from '../menu-version-history'
import { LiffPhoneMenuStep } from '../liff-phone-v8'
import shell from '../settings-v8.module.css'
import styles from './menu-form-v8.module.css'

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

  const [canEdit] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('/booking/menus'))

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
      menu.booking_window_days ?? '', menu.cutoff_hours_before ?? '', menu.cancel_deadline_hours_before ?? '',
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

  const tagCandidates = tags.filter(
    (tag) => tag.lineAccountId === selectedAccountId && tag.status !== 'archived',
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
      return
    }
    setSaving(conflict ? 'conflict' : publish ? 'publish' : 'draft')
    try {
      let menuId: string | null = editTarget?.id ?? createdMenuNeedingFollowUp?.menuId ?? null
      let version = 0

      if (menuId == null) {
        const res = await bookingApi.createMenu(selectedAccountId, menuBody(publish), idempotencyKey)
        menuId = res.id
        setCreatedMenuNeedingFollowUp({ menuId, remainingStaffIds: assignedIds, resourcesPending: resourceIds.size > 0 })
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
      let resourcesPending = createdMenuNeedingFollowUp?.resourcesPending ?? resourceIds.size > 0
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
          <NoPermissionV8
            featureName="予約メニュー"
            capabilitiesHref="/staff"
          />
        </div>
      </div>
    )
  }

  if (editId && editStatus === 'loading') {
    return (
      <div className={shell.shell} data-design-node="QqER7">
        <div className="p-10">
          <ListState kind="loading" description="メニューを読み込んでいます。" />
        </div>
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

  return (
    <div className={shell.shell} data-design-node="QqER7">
      <header className={shell.boardHead} data-design="Head">
        <Link href="/booking/menus" className={shell.backLink}>← 予約へ</Link>
        <h1 className={shell.headTitle}>{editTarget ? '予約メニューを直す' : '予約メニューを作る'}</h1>
        <p className={shell.headNote}>
          {editTarget ? '保存すると、お客さまの画面にすぐ出ます' : 'まだお客さまの画面には出ていません'}
        </p>
      </header>

      {conflict && (
        <div className={styles.conflictBand} data-design="Bar" data-design-node="v5L19Z" role="alert">
          <strong>
            {conflict.author ? `${conflict.author}さんが` : 'ほかの人が'}
            {conflict.at ? ` ${conflictTime(conflict.at)} に` : ''}
            メニュー「{conflict.name}」を保存しました
          </strong>
          <p>
            あなたが直した所はまだ保存されていません。このまま保存すると、
            {conflict.author ? `${conflict.author}さん` : 'ほかの人'}の変更が消えます。
          </p>
          <div className={styles.conflictActions}>
            <button type="button" onClick={() => setComparing(true)}>違いを比べる</button>
            <button type="button" onClick={() => void reloadLatest()}>最新を読み込んで続ける</button>
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
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.label}>メニュー名</span>
                <input
                  className={styles.input}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: トリミング（小型犬）"
                />
              </label>
              <span className={styles.field}>
                <span className={styles.label}>分類</span>
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
                    className={`${styles.input} mt-2`}
                    type="text"
                    value={categoryNew}
                    onChange={(e) => setCategoryNew(e.target.value)}
                    placeholder="新しい分類の名前（例: トリミング）"
                    aria-label="新しい分類の名前"
                  />
                )}
              </span>
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.label}>説明（お客さまに見えます）<span className={styles.optional}>任意</span></span>
                <input
                  className={styles.input}
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例: シャンプー・カット・爪切り"
                />
              </label>
            </div>
            <div className={`${styles.fieldGrid} ${styles.fieldGrid3}`}>
              <label className={styles.field}>
                <span className={styles.label}>かかる時間</span>
                <span className={styles.unitField}>
                  <input
                    type="number"
                    min={1}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    aria-label="かかる時間（分）"
                  />
                  <span className={styles.unitSuffix}>分</span>
                </span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>金額（空なら「お問い合わせ」）</span>
                <span className={styles.unitField}>
                  <span className={styles.unitSuffix}>¥</span>
                  <input
                    type="number"
                    min={0}
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    placeholder="8,400"
                    aria-label="金額（円）"
                  />
                </span>
              </label>
              <span className={styles.field}>
                <span className={styles.label}>予約したときのマイル</span>
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
              </span>
            </div>
          </section>

          {/* ② 担当スタッフ */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>担当スタッフ</h2>
              <span className={shell.sectionDesc}>1人も選ばないと、お客さまの画面に枠が出ません</span>
            </div>
            {staffStatus === 'loading' ? (
              <p className="text-ink-faint mt-3 text-sm">担当を読み込んでいます…</p>
            ) : staffStatus === 'error' ? (
              <div className="mt-3 space-y-2">
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
              <p className="text-ink-faint mt-3 text-sm">
                まだスタッフが登録されていません。先に予約設定の「担当スタッフ」から登録してください。
              </p>
            ) : (
              <>
                <div className={`${styles.chipRow} mt-3`}>
                  {staff.filter((person) => person.is_active).map((person) => {
                    const on = assigned.has(person.id)
                    return (
                      <button
                        key={person.id}
                        type="button"
                        aria-pressed={on}
                        className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                        onClick={() => toggleAssigned(person.id)}
                      >
                        <span className={styles.chipBox} aria-hidden="true">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4l2.5 2.5L9 1" /></svg>
                        </span>
                        {person.display_name || person.name}
                        {person.role ? `（${person.role}）` : ''}
                      </button>
                    )
                  })}
                </div>
                <div className={`${shell.toggleRow} mt-3`}>
                  <span className={shell.toggleRowLabel}>「指名なし」でも受ける</span>
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
            <div className="mt-2">
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
            </div>
            <div className={styles.changeRow}>
              <button type="button" className={styles.changeLink} onClick={() => setOwnRules((v) => !v)}>
                {ownRules ? 'お店のきまりに戻す' : '✎ このメニューだけ変える'}
              </button>
            </div>
          </section>

          {/* ④ 受け方 */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>受け方</h2>
            </div>
            <div className={styles.fieldCol}>
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
                    onChange={(e) => setBufferAfterMinutes(e.target.value)}
                    aria-label="後の空き時間（分）"
                  />
                  <span className={styles.unitSuffix}>分</span>
                </span>
              </label>
            </div>
          </section>

          {/* ⑤ 予約を受けたときにすること */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>予約を受けたときにすること</h2>
            </div>
            <div className="mt-3 space-y-4">
              <span className={styles.field}>
                <span className={styles.label}>付けるタグ</span>
                {tagStatus === 'loading' ? (
                  <p className="text-ink-faint text-sm">タグを読み込んでいます…</p>
                ) : tagStatus === 'error' ? (
                  <p className="text-ink-faint text-sm">タグを読み込めませんでした。タグなしで保存できます。</p>
                ) : tagCandidates.length === 0 ? (
                  <p className="text-ink-faint text-sm">このアカウントに使えるタグがありません。タグなしで保存できます。</p>
                ) : (
                  <Select
                    size="full"
                    aria-label="予約後に付けるタグ"
                    value={autoTagId ?? ''}
                    onChange={(value) => setAutoTagId(value === '' ? null : value)}
                    options={[
                      { value: '', label: '— なし —' },
                      ...tagCandidates.map((tag) => ({ value: tag.id, label: tag.name })),
                    ]}
                  />
                )}
              </span>
              <div className={shell.toggleRow}>
                <span className={shell.toggleRowLabel}>予約するときに質問を出す</span>
                <Toggle
                  label="予約するときに質問を出す"
                  checked={askQuestion}
                  onChange={setAskQuestion}
                />
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
          </section>

          {/* ⑥ 使う設備 */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>使う設備</h2>
            </div>
            {resourcesStatus === 'loading' ? (
              <p className="text-ink-faint mt-3 text-sm">設備を読み込んでいます…</p>
            ) : resourcesStatus === 'error' ? (
              <p className="text-ink-faint mt-3 text-sm">設備を読み込めませんでした。選ばずに保存できます。</p>
            ) : activeResources.length === 0 ? (
              <p className="text-ink-faint mt-3 text-sm">使える設備はまだありません。受付枠の設備から登録できます。</p>
            ) : (
              <div className={`${styles.chipRow} mt-3`}>
                {activeResources.map((item) => {
                  const on = resourceIds.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={on}
                      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                      onClick={() => toggleResource(item.id)}
                    >
                      <span className={styles.chipBox} aria-hidden="true">
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4l2.5 2.5L9 1" /></svg>
                      </span>
                      {item.name}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* ⑦ お支払い */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>お支払い <StatusBadge tone="warning" size="compact" className="ml-1">お店で払うのみ</StatusBadge></h2>
              <span className={shell.sectionDesc}>決済サービスをつなぐと選べるようになります。いまは「お店で払う」だけです。</span>
            </div>
            <RadioCardGroup legend="お支払い方法" className={`${styles.payRow} mt-3`}>
              <RadioCard
                name="menu-payment"
                value="store"
                checked
                onChange={() => {}}
                title="お店で払う"
              />
              <RadioCard
                name="menu-payment"
                value="online"
                checked={false}
                disabled
                disabledReason="決済サービスをつなぐと選べます"
                onChange={() => {}}
                title="オンラインで先払い"
              />
              <RadioCard
                name="menu-payment"
                value="either"
                checked={false}
                disabled
                disabledReason="決済サービスをつなぐと選べます"
                onChange={() => {}}
                title="どちらでも"
              />
            </RadioCardGroup>
          </section>

          {saveError && (
            <p className="text-danger mt-3 text-sm" role="alert">{saveError}</p>
          )}
          {createdMenuNeedingFollowUp && !saveError && (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-status-warn-deep)' }}>
              メニューは保存済みです。もう一度押しても新しいメニューは増えません。
            </p>
          )}
        </div>

        <aside className={shell.side} data-design="Side">
          <div className={shell.sideActions}>
            {previewUrl ? <Button href={previewUrl}>お客さまに見える画面を確かめる</Button> : null}
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

      <div className={styles.footBar} data-design="Savebar">
        {conflict ? (
          <span className={styles.footStatus}>ほかの人の変更を確かめてから保存してください</span>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => router.push('/booking/menus')}
        >
          キャンセル
        </Button>
        {!editTarget && (
          <Button
            variant="secondary"
            disabled={saving !== null}
            onClick={() => void save(false)}
          >
            {saving === 'draft' ? '保存しています…' : '下書きを保存'}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={saving !== null}
          onClick={() => void save(true, Boolean(conflict))}
        >
          {saving ? '保存しています…' : primaryLabel}
        </Button>
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
