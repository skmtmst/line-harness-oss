'use client'

import { useEffect, useState } from 'react'
import { BOOKING_STAFF_LIMITS, parseBookingStaffInput, type StaffMember } from '@line-crm/shared'
import { api, bookingApi, type BookingMenu } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
/* R309: メニュー候補の料金は一覧・割当表と同じ共通表示にする。 */
import { menuPriceLabel } from '../../lib/menu-price'
import Select from '@/components/shared/select'
import { canEditFeature } from '@/lib/staff-capability'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * 予約スタッフを登録する（設計 V2 8-2-2 / node bEL9g）。
 *
 * 以前は名前と表示名だけで、登録しても予約画面には出てこなかった。
 * 担当できるメニューが空だと枠が出ないのに、その設定が別画面にあり、
 * 画面の下に注意書きが1行あるだけだった。
 * 設計どおり、担当メニューをここで選べるようにした。
 */
export default function NewBookingStaffPage() {
  const { selectedAccountId } = useAccount()
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
  /**
   * R310: 登録は済んだが担当メニューの設定が残っているスタッフのID。
   * ここにIDがある間は createStaff を二度と呼ばず、残りの割当だけを
   * やり直す（予約メニュー作成の DEEP-16 と同じ形）。同名スタッフの
   * 二重登録を防ぐ。
   */
  const [createdStaffId, setCreatedStaffId] = useState<string | null>(null)

  // R310: 控えた登録済みIDは作ったアカウントのもの。切替後は使い回さない。
  useEffect(() => {
    setCreatedStaffId(null)
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    bookingApi
      .listMenus(selectedAccountId)
      .then((r) => {
        if (alive) setMenus(r.menus)
      })
      .catch(() => {
        // メニューが引けなくても、スタッフの登録自体はできる。
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  useEffect(() => {
    let alive = true
    api.staff.list()
      .then((res) => {
        if (alive && res.success) setMembers(res.data.filter((m) => m.isActive))
      })
      .catch(() => {
        // ログインユーザー一覧が引けなくても登録自体はできる。
      })
    return () => {
      alive = false
    }
  }, [])

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

  if (!canManageStaff) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ListState
          kind="error"
          title="予約設定の変更権限がありません"
          description="予約スタッフの登録は、予約設定の権限を持つログインユーザーだけが実行できます。管理者へ権限の確認を依頼してください。"
        />
      </div>
    )
  }

  return (
    <>
    <CreatePage
      title="予約スタッフを登録する"
      description="お客様が予約するときに指名できる担当者を登録します。"
      showHeader={false}
      parent={['予約設定', '/booking/menus?tab=staff']}
      saveLabel={createdStaffId ? '割当をやり直す' : 'スタッフを登録'}
      variant="v6"
      statusLabel={
        createdStaffId
          ? 'スタッフは登録済みです。担当メニューの設定が残っています'
          : undefined
      }
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        const parsed = parseBookingStaffInput(staffInput(), 'create')
        if (!parsed.ok) return parsed.error
        if (offered.size === 0)
          return '担当メニューを1つ以上選んでください。0だと予約画面に表示されません'
        return null
      }}
      // R310: 割当が残っている間は「保存して続けて作る」を出さない。
      // 続けて作るボタンが別スタッフの登録に見え、残りの割当を見失うため。
      onReset={createdStaffId ? undefined : () => {
        setName('')
        setDisplayName('')
        setBio('')
        setOffered(new Set())
      }}
      onSave={async () => {
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
        return staffId
      }}
      aside={
        <>
          <AsideCard title="予約画面での見え方" note="お客様のLINEでの表示です。">
            <div className="border-hairline rounded-card border p-3">
              <div className="flex items-center gap-2">
                <span className="bg-canvas-sunken h-9 w-9 shrink-0 rounded-pill" />
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-medium">{shownName}</p>
                  {role && <p className="text-ink-faint truncate text-xs">{role}</p>}
                </div>
              </div>
              {bio && <p className="text-ink-secondary mt-2 text-xs leading-5">{bio}</p>}
              {offered.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {menus
                    .filter((m) => offered.has(m.id))
                    .map((m) => (
                      <span
                        key={m.id}
                        className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[10px]"
                      >
                        {m.name}
                      </span>
                    ))}
                </div>
              )}
              <div className="bg-accent-deep text-on-accent rounded-control mt-3 px-3 py-2 text-center text-xs font-medium">
                {shownName}を指名して予約
              </div>
            </div>
          </AsideCard>

          <AsideCard title="気をつけること">
            <ul className="text-ink-secondary space-y-1.5 text-xs leading-5">
              <li>・担当メニューを1つも選ばないと、予約画面に表示されません</li>
              <li>・受付時間はメニューごとの所要時間より短くできません</li>
              <li>・「指名なし」を外すと、名前を選んだお客様だけが予約できます</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="お客様に見える情報">
        <Field label="スタッフ名" htmlFor="bs-name" required note="管理画面での呼び名です。">
          <input
            id="bs-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={BOOKING_STAFF_LIMITS.name}
            placeholder="例: 田中 美咲"
            className={inputClass}
          />
        </Field>

        <Field
          label="お客様向けの表示名"
          htmlFor="bs-display"
          note="予約画面にはこちらが表示されます。空欄なら上の名前を使います。"
        >
          <input
            id="bs-display"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={BOOKING_STAFF_LIMITS.displayName}
            placeholder="例: みさき"
            className={inputClass}
          />
        </Field>

        <Field label="肩書き" htmlFor="bs-role">
          <input
            id="bs-role"
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={BOOKING_STAFF_LIMITS.role}
            placeholder="例: トリミング担当"
            className={inputClass}
          />
        </Field>

        <Field
          label="顔写真"
          htmlFor="bs-image"
          note="正方形の画像を推奨します（1MBまで）。いまは画像のURLを貼ってください。"
        >
          <input
            id="bs-image"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            maxLength={BOOKING_STAFF_LIMITS.profileImageUrl}
            placeholder="https://…"
            className={inputClass}
          />
        </Field>

        <Field label="紹介文" htmlFor="bs-bio">
          <textarea
            id="bs-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BOOKING_STAFF_LIMITS.bio}
            placeholder="例: トリミング歴10年。小型犬が得意です。"
            className={`${inputClass} resize-y`}
          />
        </Field>
      </FormSection>

      <FormSection
        step={2}
        label="予約を受けられるメニュー"
        note="チェックしたメニューだけ、このスタッフを指名できます。"
      >
        {menus.length === 0 ? (
          <p className="text-ink-faint text-sm">
            まだメニューがありません。先に予約設定の「メニュー」から登録してください。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {menus.map((m) => (
              <li key={m.id}>
                <Checkbox
                  checked={offered.has(m.id)}
                  onCheckedChange={() => toggle(m.id)}
                  className="border-hairline hover:bg-canvas-sunken w-full rounded-mini border p-2.5"
                ><span className="flex w-full items-center gap-2"><span className="text-ink text-sm">{m.name}</span>
                  <span className="text-ink-faint ml-auto text-xs tabular-nums">
                    {m.duration_minutes}分 / {menuPriceLabel(m)}
                  </span></span>
                </Checkbox>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection step={3} label="受付と表示">
        <div className="border-hairline rounded-mini border p-3">
          <p className="text-ink text-sm">店舗の営業時間に合わせる</p>
          <p className="text-ink-faint mt-0.5 text-xs">
            個別に設定したい場合は、登録後に受付時間の画面で調整できます。
          </p>
        </div>

        <Field label="予約枠の色" note="カレンダーでの見分けに使います。">
          {/* 色を持つ列がまだ無いため、選べるように見せず現在値だけを示す。 */}
          <p className="bg-canvas-sunken text-ink-faint rounded-control px-3 py-2 text-sm">
            現在はグリーンで固定です
          </p>
        </Field>

        <Checkbox
          checked={isDesignationOptional}
          onCheckedChange={setIsDesignationOptional}
          description="お客様が担当者を選ばなかったときの割り当て対象になります。"
        >「指名なし」の枠にも含める</Checkbox>

        <Checkbox
          checked={isActive}
          onCheckedChange={setIsActive}
          description="オフにすると予約画面に表示されません。"
        >登録したらすぐ予約を受ける</Checkbox>

        <Field
          label="ログインユーザーとの紐づけ"
          htmlFor="bs-member"
          note="紐づけると、そのログインユーザーが「本人の勤務」としてこの担当者のシフト・休憩・外部連携を管理できます。"
        >
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
        </Field>
      </FormSection>
    </CreatePage>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したスタッフ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
