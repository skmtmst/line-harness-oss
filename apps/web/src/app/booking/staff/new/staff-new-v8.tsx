'use client'

/*
 * ★V8「予約スタッフを登録」（板 CcA4k）。
 *
 * 白い板1枚：頭（←担当スタッフへ・題・説明）→ 中身（左＝4つの段
 * 「お客さまに見える情報」「予約を受けられるメニュー」「受付と表示」
 * 「ログインユーザーとのひも付け」＋キャンセル・登録ボタン、右＝LIFFの
 * 担当選択の見本）。
 *
 * 動き（登録→担当メニューの割当、割当だけ失敗したときの「割当をやり直す」、
 * 未保存の離脱確認、権限での閲覧のみ化、失敗時の扱い）は v7 の
 * /booking/staff/new と同じ。テーマが v7 のときはこのファイルは読まれず、
 * 従来の見た目が出る。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BOOKING_STAFF_LIMITS, parseBookingStaffInput, type StaffMember } from '@line-crm/shared'
import { api, bookingApi, type BookingMenu, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { canEditFeature } from '@/lib/staff-capability'
import { usePageTitle } from '@/components/shell/page-chrome'
import { createPageReturnHref } from '@/components/shared/create-page'
/* R309: メニュー候補の料金は一覧・割当表と同じ共通表示にする。 */
import { menuPriceLabel } from '../../lib/menu-price'
import { LiffPhoneStaffStep } from '../../menus/liff-phone-v8'
import shell from '../../menus/settings-v8.module.css'
import styles from './staff-new-v8.module.css'

export default function StaffNewV8() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const router = useRouter()
  // /booking/staff/new はメニューの接頭辞に当たらず上部バーが空になるため、画面名を明示する。
  usePageTitle('予約スタッフを登録')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [bio, setBio] = useState('')
  const [isDesignationOptional, setIsDesignationOptional] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())
  // N-411 本人勤務: 登録と同時にログインユーザーへ紐づけられるようにする。
  const [staffMemberId, setStaffMemberId] = useState('')
  const [members, setMembers] = useState<StaffMember[]>([])
  // 右のスマホの見本に出す、登録済みの担当。
  const [staffList, setStaffList] = useState<BookingStaff[]>([])
  /**
   * R310: 登録は済んだが担当メニューの設定が残っているスタッフのID。
   * ここにIDがある間は createStaff を二度と呼ばず、残りの割当だけを
   * やり直す（予約メニュー作成の DEEP-16 と同じ形）。同名スタッフの
   * 二重登録を防ぐ。
   */
  const [createdStaffId, setCreatedStaffId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // R310: 控えた登録済みIDは作ったアカウントのもの。切替後は使い回さない。
  useEffect(() => {
    setCreatedStaffId(null)
  }, [selectedAccountId])

  /*
   * R578: 担当メニューの取得失敗と本当の0件を言い分ける。
   * 失敗しても入力済みのスタッフ情報は state に残る。再取得だけ送り直す。
   */
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
        if (alive) {
          setMenus(r.menus)
          setMenusError(null)
          setMenusLoading(false)
        }
      })
      .catch((error: unknown) => {
        // メニューが引けなくても、スタッフの登録自体はできる。
        // 失敗を空と混ぜない。「まだ無い」とは出さず再取得の口を出す。
        if (alive) {
          setMenusError(error)
          setMenusLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId, menusReloadKey])

  /*
   * 追加発見: ログインユーザー一覧の取得失敗と「誰もいない」を言い分ける。
   * 失敗しても入力済みの内容は state に残る。再取得だけ送り直す。
   */
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
        if (alive) {
          if (res.success) setMembers(res.data.filter((m) => m.isActive))
          setMembersError(null)
          setMembersLoading(false)
        }
      })
      .catch((error: unknown) => {
        // ログインユーザー一覧が引けなくても登録自体はできる。
        // 失敗を「紐づけない」と混ぜない。再取得の口を出す。
        if (alive) {
          setMembersError(error)
          setMembersLoading(false)
        }
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

  // N-411: 予約スタッフ登録は 'booking.settings' の実効permission必須。
  const [canManageStaff] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('booking.settings'))

  /*
   * 登録途中の離脱確認。名前・表示名・肩書き・写真・紹介文・メニュー割当・
   * 受付設定のどれかに手を付けていたら、キャンセルや左メニューで確認窓を出す。
   * 登録が終わると一覧へ router.push するので、成功後に警告は出ない。
   */
  const dirty = Boolean(
    name || displayName || role || imageUrl || bio || staffMemberId ||
    isDesignationOptional || !isActive || offered.size > 0
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
    if (offered.size === 0)
      return '担当メニューを1つ以上選んでください。0だと予約画面に表示されません'
    return null
  }

  /* 名前欄1欄の直し方。保存時と同じ判定のうち名前欄の分だけ出す。 */
  function nameFieldError(value: string): string | null {
    const parsed = parseBookingStaffInput(
      { ...staffInput(), name: value, display_name: displayName.trim() || value },
      'create',
    )
    if (!parsed.ok && parsed.field === 'name') return parsed.error
    return null
  }
  /* 欄を離れたときに出す1欄ずつの直し方（文は保存時と同じ）。 */
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
      // 控えたIDを使い回して割当だけ送り直す。
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
          menus.map((m) => ({
            menu_id: m.id,
            is_offered: offered.has(m.id),
            override_duration_minutes: null,
            override_price: null,
          })),
        )
      } catch {
        // スタッフ自体は残っている。IDを控えて割当のやり直しに備える。
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
      <div className={shell.shell} data-design-node="CcA4k">
        <div className="mx-auto max-w-2xl p-6">
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
  const previewMenu = menus.find((m) => m.is_active && offered.has(m.id))
    ?? menus.find((m) => m.is_active)
    ?? menus[0]
    ?? null

  return (
    <div className={shell.shell} data-design-node="CcA4k">
      <header className={shell.boardHead} data-design="Head">
        <Link href="/booking/menus?tab=staff" className={shell.backLink}>← 担当スタッフへ</Link>
        <h1 className={shell.headTitle}>予約スタッフを登録</h1>
        <p className={shell.headNote}>お客さまが予約するときに指名できる担当者を登録します。</p>
      </header>

      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          {/* ① お客さまに見える情報 */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>お客さまに見える情報</h2>
            </div>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.label}>スタッフ名（管理画面での呼び名）</span>
                <input
                  id="bs-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (fieldErrors.name !== undefined) {
                      setFieldErrors({ name: nameFieldError(e.target.value) ?? undefined })
                    }
                  }}
                  onBlur={() => {
                    setFieldErrors({ name: nameFieldError(name) ?? undefined })
                  }}
                  maxLength={BOOKING_STAFF_LIMITS.name}
                  placeholder="例: 田中 美咲"
                  className={styles.input}
                  aria-invalid={fieldErrors.name !== undefined}
                />
                {fieldErrors.name !== undefined ? (
                  <span className={styles.formError} role="alert">{fieldErrors.name}</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>お客さま向けの表示名（空欄なら上の名前）</span>
                <input
                  id="bs-display"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={BOOKING_STAFF_LIMITS.displayName}
                  placeholder="例: みさき"
                  className={styles.input}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>肩書き</span>
                <input
                  id="bs-role"
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  maxLength={BOOKING_STAFF_LIMITS.role}
                  placeholder="例: トリミング担当"
                  className={styles.input}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>顔写真（正方形・1MB まで）</span>
                <input
                  id="bs-image"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  maxLength={BOOKING_STAFF_LIMITS.profileImageUrl}
                  placeholder="https://…/misaki.jpg"
                  className={styles.input}
                />
              </label>
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.label}>紹介文</span>
                <textarea
                  id="bs-bio"
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={BOOKING_STAFF_LIMITS.bio}
                  placeholder="例: トリミング歴10年。小型犬が得意です。"
                  className={styles.input}
                />
              </label>
            </div>
          </section>

          {/* ② 予約を受けられるメニュー */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>予約を受けられるメニュー</h2>
              <p className={shell.sectionDesc}>チェックしたメニューだけ、このスタッフを指名できます。1つも選ばないと予約画面に出ません。</p>
            </div>
            {menusLoading ? (
              <ListState kind="loading" title="メニューを読み込んでいます" />
            ) : menusError !== null ? (
              <ListState
                kind="error"
                title="メニューを読み込めませんでした"
                description={isForbiddenOrRateLimited(menusError) ? undefined : '通信の不具合などでメニュー一覧を読み込めませんでした。入力した内容はそのまま残っています。「もう一度読み込む」を押してください。'}
                error={menusError}
                onRetry={() => setMenusReloadKey((value) => value + 1)}
              />
            ) : menus.length === 0 ? (
              <p className={shell.sectionDesc}>
                まだメニューがありません。先に予約設定の「メニュー」から登録してください。
              </p>
            ) : (
              <div className={styles.chipRow}>
                {menus.map((m) => {
                  const on = offered.has(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                      onClick={() => toggle(m.id)}
                    >
                      <span className={styles.chipBox} aria-hidden="true">
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4l2.5 2.5L9 1" /></svg>
                      </span>
                      {m.name}
                      <span className={styles.chipMeta}>{m.duration_minutes}分 / {menuPriceLabel(m)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* ③ 受付と表示 */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>受付と表示</h2>
            </div>
            <div className={styles.toggleList}>
              <div className={styles.switchRow}>
                <Toggle
                  label="店舗の営業時間に合わせる"
                  checked
                  locked
                />
                <span className={styles.switchLabel}>
                  店舗の営業時間に合わせる
                  <span className={styles.switchNote}>個別に変えるときは、登録後に「勤務とシフト」で調整できます。</span>
                </span>
              </div>
              <div className={styles.switchRow}>
                <Toggle
                  label="「指名なし」の枠にも含める"
                  checked={isDesignationOptional}
                  onChange={setIsDesignationOptional}
                />
                <span className={styles.switchLabel}>
                  「指名なし」の枠にも含める
                  <span className={styles.switchNote}>お客さまが担当者を選ばなかったときの割り当て先になります。</span>
                </span>
              </div>
              <div className={styles.switchRow}>
                <Toggle
                  label="登録したらすぐ予約を受ける"
                  checked={isActive}
                  onChange={setIsActive}
                />
                <span className={styles.switchLabel}>
                  登録したらすぐ予約を受ける
                  <span className={styles.switchNote}>オフにすると予約画面に出ません。</span>
                </span>
              </div>
              <div className={styles.switchRow}>
                <span className={styles.switchLabel}>予約枠の色</span>
                <span className={styles.colorChip}>
                  {/* 色を持つ列がまだ無いため、選べるように見せず現在値だけを示す。 */}
                  <span className={styles.colorSwatch} aria-hidden="true" />
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.25 7 8.75l3.5-3.5" /></svg>
                </span>
                <span className={styles.switchNote}>カレンダーでの見分けに使います。現在はグリーンで固定です。</span>
              </div>
            </div>
          </section>

          {/* ④ ログインユーザーとのひも付け */}
          <section className={shell.section}>
            <div className={shell.sectionHead}>
              <h2 className={shell.sectionTitle}>ログインユーザーとのひも付け</h2>
              <p className={shell.sectionDesc}>ひも付けると、その人が左メニュー「自分の勤務」で、このスタッフのシフト・休憩・Google カレンダーを決められます。</p>
            </div>
            {membersLoading ? (
              <ListState kind="loading" title="ログインユーザーを読み込んでいます" />
            ) : membersError !== null ? (
              <ListState
                kind="error"
                title="ログインユーザーを読み込めませんでした"
                description={isForbiddenOrRateLimited(membersError) ? undefined : '通信の不具合などでログインユーザー一覧を読み込めませんでした。入力した内容はそのまま残っています。「もう一度読み込む」を押してください。'}
                error={membersError}
                onRetry={() => setMembersReloadKey((value) => value + 1)}
              />
            ) : (
              <label className={styles.field}>
                <span className={styles.label}>ログインユーザー</span>
                <Select
                  aria-label="ログインユーザーとの紐づけ"
                  id="bs-member"
                  size="full"
                  value={staffMemberId}
                  onChange={setStaffMemberId}
                  options={[
                    { value: '', label: '紐づけない' },
                    ...members.map((m) => ({ value: m.id, label: `${m.name}${m.email ? `（${m.email}）` : ''}` })),
                  ]}
                />
              </label>
            )}
          </section>

          {createdStaffId ? (
            <div className={shell.warnBand} role="status">
              <span>スタッフは登録済みです。担当メニューの設定が残っています。</span>
            </div>
          ) : null}
          {saveError ? (
            <p className={styles.formError} role="alert">{saveError}</p>
          ) : null}
          <div className={styles.actionRow} data-design="Actions">
            <Button href="/booking/menus?tab=staff">キャンセル</Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saving}
              busy={saving}
              busyLabel="登録しています…"
            >
              {createdStaffId ? '割当をやり直す' : 'スタッフを追加する'}
            </Button>
          </div>
        </div>

        <aside className={shell.side} data-design="Side">
          <div className={shell.sideActions}>
            {previewUrl ? <Button href={previewUrl}>お客さまに見える画面を確かめる</Button> : null}
          </div>
          <p className={shell.sideTitle}>予約画面での見え方</p>
          <div className={shell.sidePhone}>
            <LiffPhoneStaffStep
              menu={previewMenu}
              staff={previewStaff}
              designationFree={isDesignationOptional}
              status={menusLoading ? 'loading' : menusError ? 'error' : 'ready'}
            />
          </div>
          <p className={shell.sideLineLink}>
            {previewUrl
              ? <a href={previewUrl} target="_blank" rel="noreferrer">実際の画面で確かめる ↗</a>
              : 'このアカウントには予約画面のURLがまだありません'}
          </p>
        </aside>
      </div>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したスタッフ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
