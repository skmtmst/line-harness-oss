'use client'

import { useEffect, useState } from 'react'
import { bookingApi, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'

/**
 * メニューを追加する（設計 V2 8-2-1 / node swtmr）。
 *
 * 設計は左に番号つきの4節、右に「予約画面での見え方」と「気をつけること」。
 * 入力欄だけ縦に並んでいると、どこまで埋めれば予約を受けられるのかが
 * 分からない。特に「担当を1人も選ばないと予約できない」は、
 * 保存できてしまうのに予約が入らないという分かりにくい失敗をする。
 */
export default function NewBookingMenuPage() {
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState('0')
  const [basePrice, setBasePrice] = useState('')
  const [concurrentCapacity, setConcurrentCapacity] = useState('1')
  const [windowDays, setWindowDays] = useState('30')
  const [cutoffHours, setCutoffHours] = useState('')
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState('')
  const [intakeQuestion, setIntakeQuestion] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /** チェックした担当。保存後に staff_menus へ流し込む。 */
  const [assigned, setAssigned] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    bookingApi
      .listStaff(selectedAccountId)
      .then((r) => {
        if (alive) setStaff(r.staff)
      })
      .catch(() => {
        // 担当の一覧が出ないだけ。あとで割り当て画面から設定できる。
      })
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  function toggle(id: string) {
    setAssigned((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <CreatePage
      designNode="GhOb3"
      title="メニューを追加する"
      description="お客様が予約するときに選ぶ内容を登録します。"
      parent={['予約設定', '/booking/menus']}
      saveLabel="メニューを追加"
      showHeader={false}
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        if (!name.trim()) return 'メニュー名を入力してください'
        if (Number(durationMinutes) < 1) return '所要時間は1分以上にしてください'
        if (assigned.size === 0)
          return '担当できる人を1人以上選んでください。0人だと予約画面に枠が出ません'
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
        setAssigned(new Set())
      }}
      onSave={async () => {
        const res = await bookingApi.createMenu(selectedAccountId!, {
          name: name.trim(),
          category_label: categoryLabel.trim() || null,
          description: description.trim() || null,
          duration_minutes: Number(durationMinutes),
          buffer_after_minutes: Number(bufferAfterMinutes) || 0,
          base_price: Number(basePrice) || 0,
          concurrent_capacity: Number(concurrentCapacity) || 1,
          booking_window_days: windowDays ? Number(windowDays) : null,
          cutoff_hours_before: cutoffHours ? Number(cutoffHours) : null,
          cancel_deadline_hours_before: cancelDeadlineHours
            ? Number(cancelDeadlineHours)
            : null,
          intake_question: intakeQuestion.trim() || null,
          is_active: isActive ? 1 : 0,
        })
        // 担当の割り当ては staff 側の表に入るので、作ったあとに1人ずつ足す。
        // ここで失敗しても、メニュー自体は作れている。
        await Promise.all(
          [...assigned].map(async (staffId) => {
            const { matrix } = await bookingApi.getStaffMenus(selectedAccountId!, staffId)
            await bookingApi.putStaffMenus(
              selectedAccountId!,
              staffId,
              matrix.map((row) => ({
                menu_id: row.menu_id,
                is_offered: row.menu_id === res.id ? true : Boolean(row.is_offered),
                override_duration_minutes: row.override_duration_minutes ?? null,
                override_price: row.override_price ?? null,
              })),
            )
          }),
        )
        return res.id
      }}
      aside={
        <>
          <AsideCard title="予約画面での見え方" note="プレビュー">
            <div className="border-hairline rounded-card border p-3">
              <p className="text-ink text-sm font-medium">{name || 'メニュー名'}</p>
              {description && (
                <p className="text-ink-secondary mt-1 text-xs leading-5">{description}</p>
              )}
              <div className="text-ink-faint mt-2 flex items-center gap-3 text-xs">
                <span>{durationMinutes || '—'}分</span>
                <span>
                  {basePrice ? `¥${Number(basePrice).toLocaleString()}` : '料金は当日ご案内'}
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
              <li>・料金を空欄にすると「料金は当日ご案内」と表示されます</li>
            </ul>
          </AsideCard>
        </>
      }
    >
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="所要時間（分）" htmlFor="bm-duration" required>
            <input
              id="bm-duration"
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </Field>
          <Field label="料金" htmlFor="bm-price" note="税込の金額を入力してください。">
            <input
              id="bm-price"
              type="number"
              min={0}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="6600"
              className={`${inputClass} tabular-nums`}
            />
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
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="同時に受けられる件数"
            htmlFor="bm-capacity"
            note="同じ時間帯に何組まで受けるかです。"
          >
            <input
              id="bm-capacity"
              type="number"
              min={1}
              value={concurrentCapacity}
              onChange={(e) => setConcurrentCapacity(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </Field>
          <Field
            label="予約を受け付ける期間"
            htmlFor="bm-window"
            note="当日から何日先まで受けるか。空欄なら制限なし。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-window"
                type="number"
                min={1}
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                placeholder="なし"
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">日先まで</span>
            </div>
          </Field>
          <Field
            label="締め切り"
            htmlFor="bm-cutoff"
            note="開始の何時間前まで受けるか。空欄なら直前まで受けます。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-cutoff"
                type="number"
                min={1}
                value={cutoffHours}
                onChange={(e) => setCutoffHours(e.target.value)}
                placeholder="なし"
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">時間前</span>
            </div>
          </Field>
          <Field
            label="キャンセル期限"
            htmlFor="bm-cancel"
            note="開始の何時間前までキャンセルできるか。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="bm-cancel"
                type="number"
                min={1}
                value={cancelDeadlineHours}
                onChange={(e) => setCancelDeadlineHours(e.target.value)}
                placeholder="なし"
                className={`${inputClass} tabular-nums`}
              />
              <span className="text-ink-faint text-xs whitespace-nowrap">時間前</span>
            </div>
          </Field>
        </div>

        <Field
          label="後の空き時間（分）"
          htmlFor="bm-buffer"
          note="片づけや移動の時間です。次の予約はこのぶん後ろから入ります。"
        >
          <input
            id="bm-buffer"
            type="number"
            min={0}
            value={bufferAfterMinutes}
            onChange={(e) => setBufferAfterMinutes(e.target.value)}
            className={`${inputClass} w-28 tabular-nums`}
          />
        </Field>
      </FormSection>

      <FormSection
        step={3}
        label="このメニューを担当できる人"
        note="チェックした人だけ、お客様が指名できます。"
      >
        {staff.length === 0 ? (
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
