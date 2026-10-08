'use client'

/*
 * ★V8「予約スタッフを登録」（板 CcA4k）。
 *
 * 白い板1枚：頭（← 担当スタッフへ・題・説明）→ 中身（左＝4つのカード
 * 「お客さまに見える情報」「予約を受けられるメニュー」「受付と表示」
 * 「ログインユーザーとのひも付け」＋キャンセル・登録、右＝LIFF の担当選びの見本）。
 *
 * 動き（登録→担当メニューの割当、割当だけ失敗したときの「割当をやり直す」、
 * 未保存の離脱確認、権限が無いときの案内、読み込み失敗の言い分け）は
 * 今までの app/booking/staff/new（v7・staff-new-v8）から写した。BEHAVIOR.md を参照。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Smartphone } from 'lucide-react'
import { BOOKING_STAFF_LIMITS, parseBookingStaffInput, type StaffMember } from '@line-crm/shared'
import { api, bookingApi, type BookingMenu, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { canEditFeature } from '@/lib/staff-capability'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { createPageReturnHref } from '@/components/shared/create-page'
import { PhoneStaffStep, priceLabel } from './phone'
import layout from './layout.module.css'
import styles from './staff-new.module.css'

/** 一度に見せるメニューの数。残りは「ほかのメニュー」で開く（1行に収める）。 */
const MENU_FOLD = 4

export default function StaffNewV8() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const router = useRouter()
  // /booking/staff/new はメニューの接頭辞に当たらず上部バーが空になるため、画面名を明示する。
  usePageTitle('予約スタッフを登録')
  /* 板の頭の「← 〇〇へ」は 2026-10-08 に無くした。一覧へは上の帯のパンくずで戻る。 */
  usePageCrumbs([{ label: '予約設定', href: '/booking/menus?tab=staff' }])
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [bio, setBio] = useState('')
  const [isDesignationOptional, setIsDesignationOptional] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())
  const [showAllMenus, setShowAllMenus] = useState(false)
  // N-411 本人勤務: 登録と同時にログインユーザーへひも付けられるようにする。
  const [staffMemberId, setStaffMemberId] = useState('')
  const [members, setMembers] = useState<StaffMember[]>([])
  // 右のスマホの見本に出す、登録済みの担当。
  const [staffList, setStaffList] = useState<BookingStaff[]>([])
  /**
   * R310: 登録は済んだが担当メニューの設定が残っているスタッフのID。
   * ここにIDがある間は createStaff を二度と呼ばず、残りの割当だけをやり直す。
   */
  const [createdStaffId, setCreatedStaffId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // R310: 控えた登録済みIDは作ったアカウントのもの。切替後は使い回さない。
  useEffect(() => {
    setCreatedStaffId(null)
  }, [selectedAccountId])

  /* R578: 担当メニューの取得失敗と本当の0件を言い分ける。失敗しても入力は残る。 */
  const [menusLoading, setMenusLoading] = useState(true)
  const [menusError, setMenusError] = useState<unknown>(null)
  const [menusReloadKey, setMenusReloadKey] = useState(0)

  useEffect(() => {
    if (!selectedAccountId) {
      setMenusLoading(false)
      return
    }
    let alive = true
    setMenusLoading(true)
    setMenusError(null)
    bookingApi
      .listMenus(selectedAccountId)
      .then((r) => {
        if (!alive) return
        setMenus(r.menus)
        setMenusError(null)
        setMenusLoading(false)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setMenusError(error)
        setMenusLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId, menusReloadKey])

  /* ログインユーザー一覧の取得失敗と「誰もいない」を言い分ける。 */
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState<unknown>(null)
  const [membersReloadKey, setMembersReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setMembersLoading(true)
    setMembersError(null)
    api.staff
      .list()
      .then((res) => {
        if (!alive) return
        if (res.success) setMembers(res.data.filter((m) => m.isActive))
        setMembersError(null)
        setMembersLoading(false)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setMembersError(error)
        setMembersLoading(false)
      })
    return () => {
      alive = false
    }
  }, [membersReloadKey])

  /* 右のスマホの見本用に、登録済みの担当を読む。失敗しても登録はできる。 */
  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    bookingApi
      .listStaff(selectedAccountId)
      .then((r) => {
        if (alive) setStaffList(r.staff)
      })
      .catch(() => {
        if (alive) setStaffList([])
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  function toggle(id: string) {
    setOffered((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // N-411: 予約スタッフ登録は 'booking.settings' の実効 permission 必須。
  const [canManageStaff] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('booking.settings'))

  /* 登録途中の離脱確認。どれかに手を付けていたら、キャンセルや左メニューで確認窓を出す。 */
  const dirty = Boolean(
    name || displayName || role || imageUrl || bio || staffMemberId ||
    isDesignationOptional || !isActive || offered.size > 0,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  const shownName = displayName.trim() || name.trim() || 'スタッフ'
  const staffInput = () => ({
    name,
    display_name: displayName.trim() || name,
    role,
    profile_image_url: imageUrl,
    bio,
    is_designation_optional: isDesignationOptional,
    is_active: isActive,
    staff_member_id: staffMemberId || null,
  })

  function validate(): string | null {
    if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
    const parsed = parseBookingStaffInput(staffInput(), 'create')
    if (!parsed.ok) return parsed.error
    if (offered.size === 0) return '担当メニューを1つ以上選んでください。0だと予約画面に表示されません'
    return null
  }

  /* 名前欄1欄の直し方。保存時と同じ判定のうち名前欄の分だけ出す。 */
  function nameFieldError(value: string): string | null {
    const parsed = parseBookingStaffInput({ ...staffInput(), name: value, display_name: displayName.trim() || value }, 'create')
    if (!parsed.ok && parsed.field === 'name') return parsed.error
    return null
  }
  const [fieldErrors, setFieldErrors] = useState<{ name?: string }>({})

  async function save() {
    if (saving) return
    const validationError = validate()
    if (validationError) {
      setSaveError(validationError)
      const nameError = nameFieldError(name)
      setFieldErrors(nameError !== null ? { name: nameError } : {})
      return
    }
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    try {
      // R310: 割当だけ失敗して戻ってきた再試行では、スタッフを作り直さない。
      let staffId = createdStaffId
      if (staffId == null) {
        const parsed = parseBookingStaffInput(staffInput(), 'create')
        if (!parsed.ok) throw new Error(parsed.error)
        const res = await bookingApi.createStaff(selectedAccountId!, parsed.value)
        staffId = res.id
      }
      // 担当メニューは staff_menus に入る。作ってから流し込む。
      try {
        await bookingApi.putStaffMenus(
          selectedAccountId!,
          staffId,
          menus.map((m) => ({ menu_id: m.id, is_offered: offered.has(m.id), override_duration_minutes: null, override_price: null })),
        )
      } catch {
        setCreatedStaffId(staffId)
        throw new Error('スタッフは登録できましたが、担当メニューの設定に失敗しました。入力は残っています。「割当をやり直す」を押してください。')
      }
      setCreatedStaffId(null)
      router.push(createPageReturnHref('/booking/menus?tab=staff', staffId))
    } catch (e) {
      setSaveError(e instanceof Error && e.message && !/^API error: /.test(e.message)
        ? e.message
        : 'スタッフを登録できませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null

  if (!canManageStaff) {
    return (
      <div className={layout.shell} data-design-node="CcA4k">
        <div className={styles.denied}>
          <ListState
            kind="error"
            title="予約設定の変更権限がありません"
            description="予約スタッフの登録は、予約設定の権限を持つログインユーザーだけが実行できます。管理者へ権限の確認を依頼してください。"
          />
        </div>
      </div>
    )
  }

  /* 右のスマホ：登録中のスタッフも見本に混ぜて、出方を確かめられるようにする。 */
  const previewStaff: BookingStaff[] = [
    ...staffList,
    {
      id: '__new__',
      name: name.trim() || 'スタッフ',
      display_name: shownName,
      role: role.trim() || null,
      profile_image_url: imageUrl.trim() || null,
      bio: bio.trim() || null,
      sort_order: Number.MAX_SAFE_INTEGER,
      is_designation_optional: isDesignationOptional ? 1 : 0,
      is_active: isActive ? 1 : 0,
    },
  ]
  // お客さまの画面の「指名なし」は、指名なしの枠に入る担当が1人でもいれば出る。
  const designationFree = previewStaff.some((s) => s.is_active && s.is_designation_optional)
  const previewMenu = menus.find((m) => m.is_active && offered.has(m.id))
    ?? menus.find((m) => m.is_active)
    ?? menus[0]
    ?? null
  const shownMenus = showAllMenus ? menus : menus.slice(0, MENU_FOLD)
  const hiddenMenus = menus.length - shownMenus.length
  const memberLabel = (m: StaffMember) => `${m.name}${m.email ? `（${m.email}）` : ''}`

  return (
    <div className={layout.shell} data-design-node="CcA4k">
      <header className={layout.head} data-design="Head">
        <h1 className={layout.title}>予約スタッフを登録</h1>
        <p className={layout.desc}>お客さまが予約するときに指名できる担当者を登録します。</p>
      </header>

      <div className={layout.body} data-design="Body">
        <div className={layout.main}>
          {/* ① お客さまに見える情報 */}
          <section className={layout.card} aria-labelledby="bs-card-info">
            <div className={layout.cardHead}><h2 id="bs-card-info" className={layout.cardTitle}>お客さまに見える情報</h2></div>
            <div className={styles.grid}>
              <div className={layout.field}>
                <label htmlFor="bs-name" className={layout.label}>スタッフ名（管理画面での呼び名）</label>
                <input
                  id="bs-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (fieldErrors.name !== undefined) setFieldErrors({ name: nameFieldError(e.target.value) ?? undefined })
                  }}
                  onBlur={() => setFieldErrors({ name: nameFieldError(name) ?? undefined })}
                  maxLength={BOOKING_STAFF_LIMITS.name}
                  placeholder="田中 美咲"
                  className={layout.input}
                  aria-invalid={fieldErrors.name !== undefined}
                />
                {fieldErrors.name !== undefined ? <span className={layout.fieldError} role="alert">{fieldErrors.name}</span> : null}
              </div>
              <div className={layout.field}>
                <label htmlFor="bs-display" className={layout.label}>お客さま向けの表示名（空欄なら上の名前）</label>
                <input id="bs-display" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={BOOKING_STAFF_LIMITS.displayName} placeholder="みさき" className={layout.input} />
              </div>
              <div className={layout.field}>
                <label htmlFor="bs-role" className={layout.label}>肩書き</label>
                <input id="bs-role" type="text" value={role} onChange={(e) => setRole(e.target.value)} maxLength={BOOKING_STAFF_LIMITS.role} placeholder="トリミング担当" className={layout.input} />
              </div>
              <div className={layout.field}>
                <label htmlFor="bs-image" className={layout.label}>顔写真（正方形・1MB まで）</label>
                <input id="bs-image" type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} maxLength={BOOKING_STAFF_LIMITS.profileImageUrl} placeholder="https://…/misaki.jpg" className={layout.input} />
              </div>
            </div>
            <div className={layout.field}>
              <label htmlFor="bs-bio" className={layout.label}>紹介文</label>
              {/* 絵は1行の高さ。改行も書けるよう textarea のまま、下の角で広げられる。 */}
              <textarea id="bs-bio" rows={1} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BOOKING_STAFF_LIMITS.bio} placeholder="トリミング歴10年。小型犬が得意です。" className={`${layout.input} ${styles.bio}`} />
            </div>
          </section>

          {/* ② 予約を受けられるメニュー */}
          <section className={layout.card} aria-labelledby="bs-card-menus">
            <div className={layout.cardHead}><h2 id="bs-card-menus" className={layout.cardTitle}>予約を受けられるメニュー</h2></div>
            <p className={layout.cardNote}>チェックしたメニューだけ、このスタッフを指名できます。1つも選ばないと予約画面に出ません。</p>
            {menusLoading ? (
              <span className={styles.checkRow} aria-busy="true">
                <span className="sr-only">メニューを読み込んでいます</span>
                <DelayedSkeleton loading skeleton={<span className={styles.checkRow} aria-hidden="true"><Skeleton width={120} height={20} /><Skeleton width={96} height={20} /><Skeleton width={136} height={20} /></span>} />
              </span>
            ) : menusError !== null ? (
              <ListState
                kind="error"
                title="メニューを読み込めませんでした"
                description={isForbiddenOrRateLimited(menusError) ? undefined : '通信の不具合などでメニュー一覧を読み込めませんでした。入力した内容はそのまま残っています。「もう一度読み込む」を押してください。'}
                error={menusError}
                onRetry={() => setMenusReloadKey((value) => value + 1)}
              />
            ) : menus.length === 0 ? (
              <p className={layout.cardNote}>まだメニューがありません。先に予約設定の「メニュー」から登録してください。</p>
            ) : (
              <div className={styles.checkRow}>
                {shownMenus.map((m) => (
                  <span key={m.id} className={styles.checkItem} title={`${m.name}（${m.duration_minutes}分・${priceLabel(m)}）`}>
                    <Checkbox checked={offered.has(m.id)} onCheckedChange={() => toggle(m.id)} className={styles.check}>{m.name}</Checkbox>
                  </span>
                ))}
                {hiddenMenus > 0 ? (
                  <button type="button" className={styles.more} onClick={() => setShowAllMenus(true)}>
                    ほかのメニュー（{hiddenMenus}）{[...offered].some((id) => !shownMenus.some((m) => m.id === id)) ? '・選択あり' : ''}
                  </button>
                ) : null}
              </div>
            )}
          </section>

          {/* ③ 受付と表示 */}
          <section className={layout.card} aria-labelledby="bs-card-accept">
            <div className={layout.cardHead}><h2 id="bs-card-accept" className={layout.cardTitle}>受付と表示</h2></div>
            <div className={styles.switchRow} title="個別に変えるときは、登録後に「勤務とシフト」で調整できます。">
              <Toggle label="店舗の営業時間に合わせる" checked locked />
              <span className={styles.switchLabel}>店舗の営業時間に合わせる</span>
            </div>
            <div className={styles.switchRow}>
              <Toggle label="「指名なし」の枠にも含める" checked={isDesignationOptional} onChange={setIsDesignationOptional} />
              <span className={styles.switchLabel}>「指名なし」の枠にも含める（お客さまが担当者を選ばなかったときの割り当て先になる）</span>
            </div>
            <div className={styles.switchRow}>
              <Toggle label="登録したらすぐ予約を受ける" checked={isActive} onChange={setIsActive} />
              <span className={styles.switchLabel}>登録したらすぐ予約を受ける（オフにすると予約画面に出ません）</span>
            </div>
            <div className={styles.colorRow}>
              <span className={styles.colorLabel}>予約枠の色</span>
              {/* 色を持つ列がまだ無いため、選べるように見せず現在値だけを示す。 */}
              <span className={styles.colorChip} title="現在はグリーンで固定です">
                <span className={styles.swatch} aria-hidden="true" />
                <span className={styles.colorDivider} aria-hidden="true" />
                <ChevronDown className={styles.colorOpen} aria-hidden="true" />
              </span>
              <span className={styles.colorNote}>カレンダーでの見分けに使います</span>
            </div>
          </section>

          {/* ④ ログインユーザーとのひも付け */}
          <section className={layout.card} aria-labelledby="bs-card-member">
            <div className={layout.cardHead}><h2 id="bs-card-member" className={layout.cardTitle}>ログインユーザーとのひも付け</h2></div>
            <p className={layout.cardNote}>ひも付けると、その人が左メニュー「自分の勤務」で、このスタッフのシフト・休憩・Google カレンダーを決められます。</p>
            {membersLoading ? (
              <span className={styles.full} aria-busy="true">
                <span className="sr-only">ログインユーザーを読み込んでいます</span>
                <DelayedSkeleton loading skeleton={<Skeleton width="100%" height={36} />} />
              </span>
            ) : membersError !== null ? (
              <ListState
                kind="error"
                title="ログインユーザーを読み込めませんでした"
                description={isForbiddenOrRateLimited(membersError) ? undefined : '通信の不具合などでログインユーザー一覧を読み込めませんでした。入力した内容はそのまま残っています。「もう一度読み込む」を押してください。'}
                error={membersError}
                onRetry={() => setMembersReloadKey((value) => value + 1)}
              />
            ) : (
              <div className={layout.field}>
                <span className={layout.smallLabel} id="bs-member-label">ログインユーザー</span>
                <span className={styles.selectBox}>
                  <Select
                    aria-label="ログインユーザーとの紐づけ"
                    id="bs-member"
                    size="full"
                    value={staffMemberId}
                    onChange={setStaffMemberId}
                    options={[{ value: '', label: '紐づけない' }, ...members.map((m) => ({ value: m.id, label: memberLabel(m) }))]}
                  />
                </span>
              </div>
            )}
          </section>

          {createdStaffId ? <p className={layout.warnBand} role="status">スタッフは登録済みです。担当メニューの設定が残っています。</p> : null}
          {saveError ? <p className={layout.fieldError} role="alert">{saveError}</p> : null}
          <div className={layout.actions} data-design="Actions">
            <Button href="/booking/menus?tab=staff">キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving} busy={saving} busyLabel="登録しています…">
              <Check className={styles.btnIcon} aria-hidden="true" />
              {createdStaffId ? '割当をやり直す' : 'スタッフを登録する'}
            </Button>
          </div>
        </div>

        <aside className={layout.side} aria-label="お客さまの予約画面の見え方" data-design="Side">
          {previewUrl ? (
            <div className={layout.sideActions}>
              <Button href={previewUrl} className={styles.sideButton}>
                <Smartphone className={styles.btnIcon} aria-hidden="true" />
                お客さまに見える画面を確かめる
              </Button>
            </div>
          ) : null}
          <p className={layout.sideTitle}>予約画面での見え方</p>
          <div className={layout.phoneSlot}>
            <PhoneStaffStep
              menu={previewMenu}
              staff={previewStaff}
              designationFree={designationFree}
              status={menusLoading ? 'loading' : menusError ? 'error' : 'ready'}
            />
          </div>
          {previewUrl ? null : <p className={layout.cardNote}>このアカウントには予約画面のURLがまだありません</p>}
        </aside>
      </div>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したスタッフ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
