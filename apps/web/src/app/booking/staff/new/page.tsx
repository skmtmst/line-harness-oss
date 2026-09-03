'use client'

import { useEffect, useState } from 'react'
import { bookingApi, type BookingMenu } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'

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
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [bio, setBio] = useState('')
  const [isDesignationOptional, setIsDesignationOptional] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())

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

  function toggle(id: string) {
    setOffered((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shownName = displayName.trim() || name.trim() || 'スタッフ'

  return (
    <CreatePage
      title="予約スタッフを登録する"
      description="お客様が予約するときに指名できる担当者を登録します。"
      parent={['予約設定', '/booking/menus?tab=staff']}
      saveLabel="スタッフを登録"
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        if (!name.trim()) return 'スタッフ名を入力してください'
        if (offered.size === 0)
          return '担当メニューを1つ以上選んでください。0だと予約画面に表示されません'
        return null
      }}
      onReset={() => {
        setName('')
        setDisplayName('')
        setBio('')
        setOffered(new Set())
      }}
      onSave={async () => {
        const res = await bookingApi.createStaff(selectedAccountId!, {
          name: name.trim(),
          display_name: displayName.trim() || name.trim(),
          role: role.trim() || null,
          profile_image_url: imageUrl.trim() || null,
          bio: bio.trim() || null,
          is_designation_optional: isDesignationOptional ? 1 : 0,
          is_active: isActive ? 1 : 0,
        })
        // 担当メニューは staff_menus に入る。作ってから流し込む。
        await bookingApi.putStaffMenus(
          selectedAccountId!,
          res.id,
          menus.map((m) => ({
            menu_id: m.id,
            is_offered: offered.has(m.id),
            override_duration_minutes: null,
            override_price: null,
          })),
        )
        return res.id
      }}
      aside={
        <>
          <AsideCard title="予約画面での見え方" note="お客様のLINEでの表示です。">
            <div className="border-hairline rounded-card border p-3">
              <div className="flex items-center gap-2">
                <span className="bg-canvas-sunken h-9 w-9 shrink-0 rounded-full" />
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
            placeholder="例: トリミング担当"
            className={inputClass}
          />
        </Field>

        <Field
          label="顔写真"
          htmlFor="bs-image"
          note="正方形の画像を推奨します（1MBまで）。いまは画像のURLを貼ってください。"
        >
          <div className="flex items-center gap-2">
            <input
              id="bs-image"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
            {/* 画像をこの画面から上げる仕組みがまだ無い。押せない状態で
                置いておき、いまはURLで受ける。 */}
            <button
              type="button"
              disabled
              title="画像のアップロードは準備中です"
              className="border-hairline text-ink-faint rounded-control shrink-0 border px-3 py-2 text-sm opacity-50"
            >
              画像を選ぶ
            </button>
          </div>
        </Field>

        <Field label="紹介文" htmlFor="bs-bio">
          <textarea
            id="bs-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
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
                <label className="border-hairline hover:bg-canvas-sunken flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
                  <input
                    type="checkbox"
                    checked={offered.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="accent-accent"
                  />
                  <span className="text-ink text-sm">{m.name}</span>
                  <span className="text-ink-faint ml-auto text-xs tabular-nums">
                    {m.duration_minutes}分 / ¥{m.base_price.toLocaleString()}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection step={3} label="受付と表示">
        <div className="border-hairline rounded-md border p-3">
          <p className="text-ink text-sm">店舗の営業時間に合わせる</p>
          <p className="text-ink-faint mt-0.5 text-xs">
            個別に設定したい場合は、登録後に受付時間の画面で調整できます。
          </p>
        </div>

        <Field label="予約枠の色" htmlFor="bs-color" note="カレンダーでの見分けに使います。">
          {/* 色を持つ列がまだ無い。増やすと消せないので、決まってから足す。 */}
          <select
            id="bs-color"
            disabled
            title="予約枠の色は準備中です"
            className={`${inputClass} opacity-50`}
          >
            <option>グリーン</option>
          </select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={isDesignationOptional}
            onChange={(e) => setIsDesignationOptional(e.target.checked)}
            className="accent-accent mt-0.5"
          />
          <span>
            <span className="text-ink text-sm">「指名なし」の枠にも含める</span>
            <span className="text-ink-faint block text-xs">
              お客様が担当者を選ばなかったときの割り当て対象になります。
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-accent mt-0.5"
          />
          <span>
            <span className="text-ink text-sm">登録したらすぐ予約を受ける</span>
            <span className="text-ink-faint block text-xs">
              オフにすると予約画面に表示されません。
            </span>
          </span>
        </label>
      </FormSection>
    </CreatePage>
  )
}
