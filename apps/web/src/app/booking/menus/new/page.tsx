'use client'

import { useEffect, useState } from 'react'
import { api, ApiError, bookingApi, type BookingSettings, type BookingStaff } from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import SelectField from '@/components/shared/select-field'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { canEditFeature } from '@/lib/staff-capability'
import { bookingMenuError } from '../menu-validation'

/**
 * メニューを追加する（設計 V6 28-1-B / node GhOb3）。
 *
 * 設計は左に番号つきの4節、右に「予約画面での見え方」と「気をつけること」。
 * 入力欄だけ縦に並んでいると、どこまで埋めれば予約を受けられるのかが
 * 分からない。特に「担当を1人も選ばないと予約できない」は、
 * 保存できてしまうのに予約が入らないという分かりにくい失敗をする。
 */
export default function NewBookingMenuPage() {
  // N-411: メニュー作成は '/booking/menus' の実効permission必須。
  // 鍵の無い人がフォームを埋めて保存時403になるのを防ぐ。
  const [canEditMenus] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('/booking/menus'))
  usePageTitle('予約メニューをつくる')
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState('0')
  const [basePrice, setBasePrice] = useState('')
  const [concurrentCapacity, setConcurrentCapacity] = useState('1')
  const [windowDays, setWindowDays] = useState('')
  const [cutoffHours, setCutoffHours] = useState('')
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState('')
  const [intakeQuestion, setIntakeQuestion] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /**
   * 担当一覧の取得状態。取得中・失敗を「未登録(0人)」と混ぜない。
   * 取得が終わるまで作成できない（DEEP-17: 候補の無いIDを送らないため）。
   */
  const [staffLoadState, setStaffLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [storeSettings, setStoreSettings] = useState<BookingSettings | null>(null)
  const [bookingMileage, setBookingMileage] = useState<number | null>(null)
  /**
   * 作成に成功したが担当設定が残っているメニュー（DEEP-16）。
   * ここにIDがある間は createMenu を二度と呼ばず、残りの担当設定だけを
   * やり直す。remainingStaffIds はまだ割当が済んでいない担当。
   */
  const [createdMenuNeedingStaff, setCreatedMenuNeedingStaff] = useState<{
    menuId: string
    remainingStaffIds: string[]
  } | null>(null)
  /** チェックした担当。保存後に staff_menus へ流し込む。 */
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  /** 予約後に自動で付けるタグ。null は「付けない」。 */
  const [autoTagId, setAutoTagId] = useState<string | null>(null)
  const [tagQuery, setTagQuery] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  /** タグ候補の取得状態。失敗・未取得でもタグなしの保存は止めない。 */
  const [tagLoadState, setTagLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

  // 担当一覧と店舗設定は別々に取る。片方の失敗・遅延でもう片方を巻き込まない
  // （担当が読めているのに設定待ちで作れない、という止まり方をしない）。
  useEffect(() => {
    setStaff([])
    setStoreSettings(null)
    setStaffLoadState('loading')
    if (!selectedAccountId) return
    let alive = true
    bookingApi.listStaff(selectedAccountId)
      .then((staffResult) => {
        if (!alive) return
        setStaff(staffResult.staff)
        setStaffLoadState('ready')
      })
      .catch(() => {
        // 取得失敗は「未登録」と混ぜない。登録作業へ誘導しない。
        if (alive) {
          setStaff([])
          setStaffLoadState('error')
        }
      })
    bookingApi.getSettings(selectedAccountId)
      .then((settingsResult) => {
        if (!alive) return
        setStoreSettings(settingsResult.success ? settingsResult.data : null)
      })
      .catch(() => {
        // 店舗設定は空欄時の既定値表示にだけ使う。取れなくても作成は止めない。
        if (alive) setStoreSettings(null)
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  useEffect(() => {
    let cancelled = false
    setTagLoadState('loading')
    api.tags
      .list()
      .then((r) => {
        if (cancelled) return
        // 取得失敗はタグなし保存の妨げにしない。候補が出ないだけで残す。
        if (r.success) {
          setTags(r.data)
          setTagLoadState('ready')
        } else {
          setTagLoadState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setTagLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // アカウントを変えたら前の選択を残さない。別アカウントのタグを
  // そのまま送ると Worker が tag_not_found で落とすうえ、意図しない結び付きになる。
  useEffect(() => {
    setAutoTagId(null)
    setTagQuery('')
    // DEEP-17: 担当の選択も前アカウントのIDのまま残さない。チェックが
    // 画面から消えても集合に残ると、切替先のメニューへ前アカウントの
    // 担当を割り当ててしまう。作成済みの部分成功状態も、このアカウントの
    // ものではなくなるので一緒に閉じる。
    setAssigned(new Set())
    setCreatedMenuNeedingStaff(null)
  }, [selectedAccountId])

  useEffect(() => {
    let alive = true
    api.mileage.rules()
      .then((response) => {
        if (!alive || !response.success) return
        const rule = response.data.find((item) => item.eventType === 'booking_created' && item.isActive)
        setBookingMileage(rule?.amount ?? null)
      })
      .catch(() => {
        if (alive) setBookingMileage(null)
      })
    return () => { alive = false }
  }, [])

  function toggle(id: string) {
    setAssigned((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // DEEP-17: 「選択済み」として数えるのは、今の候補一覧に実在するIDだけ。
  // 候補の読み直しやアカウント切替で画面から消えた担当を、見えないまま
  // 新しいメニューへ割り当てない。
  const assignedIds = [...assigned].filter((id) => staff.some((s) => s.id === id))

  // 候補は「今選んでいるアカウントの有効なタグ」だけ。別アカウントのものと
  // 整理済み(archived)は選ばせない。保存側の tag_not_found 検証と二重化する。
  const tagCandidates = tags.filter(
    (t) => t.lineAccountId === selectedAccountId && t.status !== 'archived',
  )
  const trimmedQuery = tagQuery.trim()
  const visibleTagCandidates = trimmedQuery === ''
    ? tagCandidates
    : tagCandidates.filter((t) => t.name.includes(trimmedQuery))
  // 検索で選んだタグが隠れても選択自体は残す。検索を消せば戻る。
  const selectedTag = tagCandidates.find((t) => t.id === autoTagId) ?? null
  const tagOptions = selectedTag != null
      && !visibleTagCandidates.some((t) => t.id === selectedTag.id)
    ? [selectedTag, ...visibleTagCandidates]
    : visibleTagCandidates

  const priceMode = basePrice.trim() === ''
    ? 'inquiry'
    : Number(basePrice) === 0
      ? 'free'
      : 'fixed'
  const priceLabel = priceMode === 'inquiry'
    ? 'お問い合わせ'
    : priceMode === 'free'
      ? '無料'
      : `¥${Number(basePrice).toLocaleString()}`

  if (!canEditMenus) {
    return (
      <div data-design-node="GhOb3" className="mx-auto max-w-2xl p-6">
        <ListState
          kind="error"
          title="予約メニューの変更権限がありません"
          description="メニューの作成・変更は、予約メニューの権限を持つログインユーザーだけが実行できます。管理者へ権限の確認を依頼してください。"
        />
      </div>
    )
  }

  return (
    <CreatePage
      designNode="GhOb3"
      title="予約メニューをつくる"
      description="お客様が予約するときに選ぶ内容を登録します。"
      parent={['予約設定', '/booking/menus']}
      saveLabel={
        createdMenuNeedingStaff
          ? '担当の設定をやり直す'
          : isActive
            ? 'つくって出す'
            : '下書きに保存'
      }
      showHeader={false}
      variant="v6"
      statusLabel={
        createdMenuNeedingStaff
          ? 'メニューは作成済みです。担当の設定が残っています'
          : isActive
            ? 'まだ出していません'
            : '下書きとして保存'
      }
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        // DEEP-17: 担当候補が確定するまで作らせない。取得中・取得失敗のまま
        // 保存すると「0人のメニュー」か「候補外のIDを持つメニュー」ができる。
        if (staffLoadState === 'loading') {
          return '担当スタッフを読み込んでいます。読み込みが終わってから作成してください'
        }
        if (staffLoadState === 'error') {
          return '担当スタッフを読み込めませんでした。開き直してから作成してください'
        }
        const validationError = bookingMenuError({
          name,
          durationMinutes,
          bufferAfterMinutes,
          sortOrder: 0,
          assignedStaffCount: assignedIds.length,
        })
        if (validationError) return validationError
        // 候補にないタグ(削除済み・別アカウント)は送らない。入力は残して選び直させる。
        if (
          autoTagId != null
          && tagLoadState === 'ready'
          && !tagCandidates.some((t) => t.id === autoTagId)
        ) {
          return '選んだタグは使えなくなりました。選び直すか「なし」にしてください'
        }
        return null
      }}
      // DEEP-16: 作成済みメニューの担当設定が残っている間は
      // 「保存して続けて作る」を出さない。続けて作るボタンが別メニューを
      // 作る導線に見えるため、部分成功の状態では閉じる。
      onReset={createdMenuNeedingStaff ? undefined : () => {
        setName('')
        setDescription('')
        setAssigned(new Set())
        setAutoTagId(null)
        setTagQuery('')
        setCreatedMenuNeedingStaff(null)
      }}
      onSave={async () => {
        // DEEP-16: メニューが作成済みなら createMenu は二度と呼ばない。
        // 同名メニューの二重作成を防ぐため、残りの担当設定だけを再開する。
        let menuId = createdMenuNeedingStaff?.menuId ?? null
        if (menuId == null) {
          let res
          try {
            res = await bookingApi.createMenu(selectedAccountId!, {
            name: name.trim(),
            category_label: categoryLabel.trim() || null,
            description: description.trim() || null,
            duration_minutes: Number(durationMinutes),
            buffer_after_minutes: Number(bufferAfterMinutes) || 0,
            base_price: Number(basePrice) || 0,
            price_mode: priceMode,
            concurrent_capacity: Number(concurrentCapacity) || 1,
            booking_window_days: windowDays ? Number(windowDays) : null,
            cutoff_hours_before: cutoffHours ? Number(cutoffHours) : null,
            cancel_deadline_hours_before: cancelDeadlineHours
              ? Number(cancelDeadlineHours)
              : null,
            intake_question: intakeQuestion.trim() || null,
            is_active: isActive ? 1 : 0,
            auto_tag_id: autoTagId,
            })
          } catch (e) {
            // 選んだ後にタグが消えた場合は Worker が tag_not_found で落とす。
            // 入力は残る(CreatePage が失敗時に初期化しない)ので選び直せる。
            if (e instanceof ApiError && e.code === 'tag_not_found') {
              throw new Error('選んだタグは削除されたため保存できませんでした。タグを選び直してください。')
            }
            throw e
          }
          menuId = res.id
          // 作成に成功した時点でIDを保持する。ここから先の失敗は
          // 「担当設定だけのやり直し」に閉じ込め、作成を繰り返させない。
          setCreatedMenuNeedingStaff({ menuId, remainingStaffIds: assignedIds })
        }

        // 担当の割り当ては staff 側の表に入るので、1人ずつ足す。
        // PUT は同じ割当を書き直すだけなので再送しても重複しない。
        // 再開時は「まだ割当が済んでいない担当のうち、今も選ばれている人」
        // だけを処理する（チェックを外した人は諦めたものとして扱う）。
        const pendingStaffIds = createdMenuNeedingStaff
          ? createdMenuNeedingStaff.remainingStaffIds.filter((sid) => assigned.has(sid))
          : assignedIds
        const failedStaffIds: string[] = []
        await Promise.all(
          pendingStaffIds.map(async (staffId) => {
            try {
              const { matrix } = await bookingApi.getStaffMenus(selectedAccountId!, staffId)
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
            } catch {
              failedStaffIds.push(staffId)
            }
          }),
        )
        if (failedStaffIds.length > 0) {
          // 成功した担当は消さず、失敗した担当だけを残して再開できるようにする。
          setCreatedMenuNeedingStaff({ menuId, remainingStaffIds: failedStaffIds })
          throw new Error('メニューは作成済みですが、一部の担当スタッフを保存できませんでした。下の「担当の設定をやり直す」で残りだけを再試行できます。')
        }
        setCreatedMenuNeedingStaff(null)
        return menuId
      }}
      aside={
        <>
          <AsideCard title="メニューをえらぶ画面では こう見えます" note="プレビュー">
            <div className="border-hairline rounded-card border p-3">
              <p className="text-ink text-sm font-medium">{name || 'メニュー名'}</p>
              {description && (
                <p className="text-ink-secondary mt-1 text-xs leading-5">{description}</p>
              )}
              <div className="text-ink-faint mt-2 flex items-center gap-3 text-xs">
                <span>{durationMinutes || '—'}分</span>
                <span>
                  {priceLabel}
                </span>
              </div>
              <div className="bg-accent-deep text-on-accent rounded-control mt-3 px-3 py-2 text-center text-xs font-medium">
                このメニューで予約する
              </div>
            </div>
          </AsideCard>

          <AsideCard title="気をつけること">
            <ul className="text-ink-secondary space-y-1.5 text-xs leading-5">
              <li>・担当スタッフを1人も選ばないと予約できません</li>
              <li>・所要時間は受付時間の区切りに合わせて表示されます</li>
              <li>・料金を空欄にすると「お問い合わせ」と表示されます</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      {createdMenuNeedingStaff && (
        <div className="border-warning bg-warning-bg text-warning rounded-control border p-3 text-sm">
          <p>
            メニューは作成済みです。もう一度押しても新しいメニューは増えません。
            担当にチェックを付けたまま「担当の設定をやり直す」を押すと、
            残りの担当設定だけをやり直します。
          </p>
          <div className="mt-2">
            <Button href={`/booking/menus?tab=staff&menu=${encodeURIComponent(createdMenuNeedingStaff.menuId)}`}>
              担当スタッフを一覧で設定する
            </Button>
          </div>
        </div>
      )}
      <FormSection step={1} label="お客様に見える情報">
        <Field label="メニュー名" htmlFor="bm-name" required>
          <input
            id="bm-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: トリミング（小型犬）"
            className={inputClass}
          />
        </Field>

        {/* U055: 320pxで2列のままだと数値欄と単位が潰れるので、
            狭い画面では1列に積む。単位はラベルではなく入力のすぐ右に
            置いて、どの欄も「数値 + 単位」の同じ並びにそろえる。 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <Field label="所要時間" htmlFor="bm-duration" required>
            <div className="flex items-center gap-1.5">
              <input
                id="bm-duration"
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint whitespace-nowrap text-xs">分</span>
            </div>
          </Field>
          <Field label="料金" htmlFor="bm-price" note="税込の金額。0円は「無料」、空けると「お問い合わせ」と出ます。">
            <div className="flex items-center gap-1.5">
              <input
                id="bm-price"
                type="number"
                min={0}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="6600"
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint whitespace-nowrap text-xs">円</span>
            </div>
          </Field>
        </div>

        <Field label="分類" htmlFor="bm-category" note="お客様の画面で見出しになります。">
          <input
            id="bm-category"
            type="text"
            value={categoryLabel}
            onChange={(e) => setCategoryLabel(e.target.value)}
            placeholder="例: トリミング"
            className={inputClass}
          />
        </Field>

        <Field label="説明" htmlFor="bm-desc">
          <textarea
            id="bm-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: シャンプー・カット・爪切り・耳そうじが含まれます。"
            className={`${inputClass} resize-y`}
          />
        </Field>
      </FormSection>

      <FormSection step={2} label="予約の受け方">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <Field
            label="同時に受けられる件数"
            htmlFor="bm-capacity"
            note="同じ時間帯に何組まで受けるかです。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-capacity"
                type="number"
                min={1}
                value={concurrentCapacity}
                onChange={(e) => setConcurrentCapacity(e.target.value)}
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint whitespace-nowrap text-xs">件</span>
            </div>
          </Field>
          <Field
            label="予約を受け付ける期間"
            htmlFor="bm-window"
            note={`空欄なら店舗設定を使います${storeSettings ? `（現在 ${storeSettings.bookingWindowDays}日）` : ''}。`}
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-window"
                type="number"
                min={1}
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                placeholder={storeSettings ? String(storeSettings.bookingWindowDays) : '店舗設定'}
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">日先まで</span>
            </div>
          </Field>
          <Field
            label="締め切り"
            htmlFor="bm-cutoff"
            note={`空欄なら店舗設定を使います${storeSettings ? `（現在 ${storeSettings.cutoffMinutesBefore / 60}時間前）` : ''}。`}
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-cutoff"
                type="number"
                min={1}
                value={cutoffHours}
                onChange={(e) => setCutoffHours(e.target.value)}
                placeholder={storeSettings ? String(storeSettings.cutoffMinutesBefore / 60) : '店舗設定'}
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">時間前</span>
            </div>
          </Field>
          <Field
            label="キャンセル期限"
            htmlFor="bm-cancel"
            note={`空欄なら店舗設定を使います${storeSettings ? `（現在 ${storeSettings.cancelDeadlineMinutesBefore / 60}時間前）` : ''}。`}
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-cancel"
                type="number"
                min={1}
                value={cancelDeadlineHours}
                onChange={(e) => setCancelDeadlineHours(e.target.value)}
                placeholder={storeSettings ? String(storeSettings.cancelDeadlineMinutesBefore / 60) : '店舗設定'}
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">時間前</span>
            </div>
          </Field>
        </div>

        <Field
          label="後の空き時間"
          htmlFor="bm-buffer"
          note="片づけや移動の時間です。次の予約はこのぶん後ろから入ります。"
        >
          <div className="flex items-center gap-1.5">
            <input
              id="bm-buffer"
              type="number"
              min={0}
              value={bufferAfterMinutes}
              onChange={(e) => setBufferAfterMinutes(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
            <span className="text-ink-faint whitespace-nowrap text-xs">分</span>
          </div>
        </Field>
      </FormSection>

      <FormSection
        step={3}
        label="このメニューを担当できる人"
        note="チェックした人だけ、お客様が指名できます。"
      >
        {staffLoadState === 'loading' ? (
          <p className="text-ink-faint text-sm">
            担当を読み込んでいます…
          </p>
        ) : staffLoadState === 'error' ? (
          <p className="text-ink-faint text-sm">
            担当を読み込めませんでした。開き直してください。
          </p>
        ) : staff.length === 0 ? (
          <p className="text-ink-faint text-sm">
            まだスタッフが登録されていません。先に予約設定の「担当スタッフ」から登録してください。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {staff.map((s) => (
              <li key={s.id}>
                <label className="border-hairline hover:bg-canvas-sunken flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
                  <input
                    type="checkbox"
                    checked={assigned.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="accent-accent"
                  />
                  <span className="text-ink text-sm">{s.display_name || s.name}</span>
                  {s.role && <span className="text-ink-faint text-xs">{s.role}</span>}
                  {s.is_designation_optional === 1 && (
                    <span className="text-ink-faint ml-auto text-xs">
                      指名なし（空いている人が担当します）
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection
        step={4}
        label="予約を受けたときにすること"
        note="現在つながっている自動処理を確認できます。"
      >
        <div className="space-y-2">
          <ActionSummary
            title="予約を受け付けたことを知らせる"
            detail="日時・メニュー・場所を書いた案内をLINEへ送ります。"
            status="自動"
          />
          <ActionSummary
            title="前日・開始前に思い出してもらう"
            detail="確定した予約は、前日と設定時間前のリマインダへ登録されます。"
            status="自動"
          />
          <ActionSummary
            title={bookingMileage === null ? '予約時のマイル' : `マイルを ${bookingMileage.toLocaleString()} 付ける`}
            detail={bookingMileage === null ? '「予約した」のマイル設定を取得できませんでした。' : 'たまる決めごと「予約してくれた」が適用されます。'}
            status={bookingMileage === null ? '未取得' : `予約で ${bookingMileage.toLocaleString()}`}
            href="/mileage/score-rules"
          />
        </div>
        <Field
          label="予約後に付けるタグ"
          htmlFor="bm-auto-tag"
          note="このメニューで予約が入ると、予約した人の友だちに自動で付きます。付けないときは「なし」のままにしてください。"
        >
          {tagLoadState === 'loading' ? (
            <p className="text-ink-faint text-sm">タグを読み込んでいます…</p>
          ) : tagLoadState === 'error' ? (
            <p className="text-ink-faint text-sm">
              タグを読み込めませんでした。タグなしで保存できます。
            </p>
          ) : tagCandidates.length === 0 ? (
            <p className="text-ink-faint text-sm">
              このアカウントに使えるタグがありません。タグなしで保存できます。
            </p>
          ) : (
            <div className="space-y-2">
              <SearchField
                value={tagQuery}
                onChange={setTagQuery}
                onClear={() => setTagQuery('')}
                placeholder="タグを検索"
                maxLength={100}
                aria-label="タグを検索"
              />
              <SelectField
                id="bm-auto-tag"
                aria-label="予約後に付けるタグ"
                value={autoTagId ?? ''}
                onChange={(e) => setAutoTagId(e.target.value === '' ? null : e.target.value)}
                options={[{ value: '', label: '— なし —' }, ...tagOptions.map((t) => ({ value: t.id, label: t.name }))]}
                className="w-full"
              />
              {trimmedQuery !== '' && visibleTagCandidates.length === 0 && (
                <p className="text-ink-faint text-xs">
                  「{trimmedQuery}」に合うタグがありません。
                </p>
              )}
            </div>
          )}
        </Field>
      </FormSection>

      <FormSection
        step={5}
        label="予約時に質問を出す"
        note="犬種・体重など、当日必要な情報を先に聞けます。"
      >
        <Field label="質問文" htmlFor="bm-intake" note="空欄なら質問しません。">
          <input
            id="bm-intake"
            type="text"
            value={intakeQuestion}
            onChange={(e) => setIntakeQuestion(e.target.value)}
            placeholder="例: ワンちゃんの犬種と体重を教えてください"
            maxLength={200}
            className={inputClass}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-accent mt-0.5"
          />
          <span>
            <span className="text-ink text-sm">追加したらすぐ予約を受ける</span>
            <span className="text-ink-faint block text-xs">
              オフにすると下書きとして保存され、予約画面に出ません。
            </span>
          </span>
        </label>
      </FormSection>
    </CreatePage>
  )
}

function ActionSummary({ title, detail, status, href }: {
  title: string
  detail: string
  status: string
  href?: string
}) {
  const content = (
    <>
      <span className="min-w-0">
        <span className="text-ink block text-sm font-medium">{title}</span>
        <span className="text-ink-faint mt-0.5 block text-xs">{detail}</span>
      </span>
      <span className="bg-success-bg text-success rounded-pill ml-auto shrink-0 px-2 py-1 text-xs font-medium">{status}</span>
    </>
  )
  return (
    <div className="border-hairline flex items-center gap-3 rounded-control border p-3">
      {content}
      {href && <Button href={href}>設定を見る</Button>}
    </div>
  )
}
