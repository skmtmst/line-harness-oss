'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { FriendFieldType, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]

/** 選択肢が要る種類。ここでだけ選択肢の入力欄を出す。 */
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])

/**
 * 項目名から差し込み名の候補を作る。
 *
 * 日本語の項目名からは作れないので、その場合は空のままにして人に決めてもらう。
 * 適当なローマ字を当てると、あとから読めない差し込み名が残る。
 */
function suggestKey(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!ascii || !/^[a-z]/.test(ascii)) return ''
  return ascii.slice(0, 32)
}

function NewFriendFieldForm() {
  const router = useRouter()
  const params = useSearchParams()
  // 友だち詳細から来たときは、保存後にそこへ戻す。
  const back = params.get('back')

  const [name, setName] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<FriendFieldType>('text')
  const [options, setOptions] = useState('')
  const [defaultValue, setDefaultValue] = useState('')
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(false)
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 友だち詳細の上に並ぶタブは、このフォルダで決まる。
  useEffect(() => {
    void api.folders.list('friend_field').then((res) => {
      if (res.success) setFolders(res.data)
    })
  }, [])

  const optionList = options
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const save = async (andAnother: boolean) => {
    if (saving) return
    if (!name.trim()) {
      setError('項目名を入力してください')
      return
    }
    if (!fieldKey.trim()) {
      setError('差し込み名を入力してください')
      return
    }
    if (NEEDS_OPTIONS.has(type) && optionList.length === 0) {
      setError('選択肢を1つ以上入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.friendFields.create({
        name: name.trim(),
        fieldKey: fieldKey.trim(),
        type,
        folderId: folderId || null,
        options: NEEDS_OPTIONS.has(type) ? optionList : null,
        defaultValue: defaultValue.trim() || null,
        isPersonal,
        isStarred,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      if (andAnother) {
        // 続けて作るときは、種類と取り扱いは残す。同じ性質の項目を
        // まとめて作ることが多い。
        setName('')
        setFieldKey('')
        setKeyTouched(false)
        setOptions('')
        setDefaultValue('')
        return
      }
      router.push(back ?? `/tags?tab=fields&highlight=${res.data.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('その差し込み名は既に使われています')
      } else if (e instanceof ApiError && e.status === 422) {
        setError(e.message)
      } else {
        setError('保存に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div data-design="Head">
        <Header
          title="項目を追加する"
          description="友だちごとに持たせる情報の入れ物を作ります。入力の形式と、どこで使うかを決めます。"
        />
      </div>

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/tags?tab=fields" className="hover:underline">
          友だち属性
        </Link>
        <span className="mx-1.5">›</span>
        <span>項目を追加</span>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-5">
      <section className="bg-canvas rounded-card border-hairline space-y-5 border p-6 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <div>
          <p className="text-ink mb-3 text-sm font-semibold">1. どの項目か</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ff-name" className="text-ink-secondary mb-1 block text-sm font-medium">
                項目名 <span className="text-danger">*</span>
              </label>
              <input
                id="ff-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!keyTouched) setFieldKey(suggestKey(e.target.value))
                }}
                placeholder="例: アレルギー"
                className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
              <p className="text-ink-faint mt-1 text-xs">画面に出る名前です。日本語で構いません。</p>
            </div>
            <div>
              {/* 友だち詳細の上に並ぶタブは、このフォルダで決まる。 */}
              <label htmlFor="ff-folder" className="text-ink-secondary mb-1 block text-sm font-medium">
                フォルダ
              </label>
              <select
                id="ff-folder"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
              >
                <option value="">未分類</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <p className="text-ink-faint mt-1 text-xs">友だち詳細のどのタブに並ぶかが決まります。</p>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="ff-key" className="text-ink-secondary mb-1 block text-sm font-medium">
            差し込み名 <span className="text-danger">*</span>
          </label>
          <input
            id="ff-key"
            type="text"
            value={fieldKey}
            onChange={(e) => {
              setKeyTouched(true)
              setFieldKey(e.target.value)
            }}
            placeholder="pet_name"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。
            {fieldKey && (
              <>
                <br />
                テンプレートには{' '}
                <code className="bg-canvas-sunken rounded px-1">{`{{field.${fieldKey}}}`}</code>{' '}
                と書きます。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>変えるとテンプレートの差し込みが空になるためです。
          </p>
        </div>

        <div>
          <p className="text-ink mb-3 text-sm font-semibold">2. 入力の形式</p>
          {/*
            設計は選ぶものを札で並べる。プルダウンだと、開くまで何が
            選べるか分からない。種類はあとから変えられないので、
            決める前に全部見えている方がよい。
          */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-control border px-3 py-2.5 text-left transition-colors ${
                  type === t
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline hover:bg-canvas-sunken'
                }`}
              >
                <span className="text-ink block text-sm font-medium">{FIELD_TYPE_LABELS[t]}</span>
                <span className="text-ink-faint block text-xs">{FIELD_TYPE_HINTS[t]}</span>
              </button>
            ))}
          </div>
          <p className="text-ink-faint mt-2 text-xs">
            <strong>あとから変えられません。</strong>すでに入っている値の意味が変わるためです。
          </p>
        </div>

        {NEEDS_OPTIONS.has(type) && (
          <div>
            <label htmlFor="ff-options" className="text-ink-secondary mb-1 block text-sm font-medium">
              選択肢 <span className="text-danger">*</span>
            </label>
            <textarea
              id="ff-options"
              rows={5}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder={'犬\n猫\nうさぎ'}
              className="border-hairline rounded-control w-full resize-y border px-3 py-2 text-sm"
            />
            <p className="text-ink-faint mt-1 text-xs">1行に1つ。あとから増やせます。</p>
          </div>
        )}

        <div>
          <label htmlFor="ff-default" className="text-ink-secondary mb-1 block text-sm font-medium">
            初期値
          </label>
          <input
            id="ff-default"
            type="text"
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
          />
          <p className="text-ink-faint mt-1 text-xs">
            値が入っていない人の差し込みに使われます。空欄なら何も入りません。
          </p>
        </div>

      </section>

      <section className="bg-canvas rounded-card border-hairline space-y-3 border p-6 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <p className="text-ink text-sm font-semibold">3. どこで使うか</p>

        <label className="border-hairline rounded-control flex cursor-pointer items-start gap-3 border p-3">
          <input
            type="checkbox"
            checked={isStarred}
            onChange={(e) => setIsStarred(e.target.checked)}
            className="accent-accent mt-0.5"
          />
          <span className="text-ink-secondary text-sm">
            友だち一覧に表示する
            <span className="text-ink-faint block text-xs">
              ★を付けると、友だち一覧の「★つき友だち情報」列に出ます。
            </span>
          </span>
        </label>

        {/*
          設計は「回答フォームの登録先」「テンプレートの差し込み」も
          切り替えにしている。どちらも項目を作った時点で常に使えるので、
          切り替える対象が無い。切れるように見せると、切ったつもりで
          切れていない状態になる。できることとして書くだけにする。
        */}
        <div className="border-hairline rounded-control border p-3">
          <p className="text-ink-secondary text-sm">回答フォームの登録先として選べます</p>
          <p className="text-ink-faint text-xs">フォームの各項目から、この項目を登録先に指定できます。</p>
        </div>
        <div className="border-hairline rounded-control border p-3">
          <p className="text-ink-secondary text-sm">テンプレートに差し込めます</p>
          <p className="text-ink-faint text-xs">
            差し込みキー{' '}
            <code className="bg-canvas-sunken rounded px-1">
              {fieldKey ? `{{field.${fieldKey}}}` : '{{field.…}}'}
            </code>{' '}
            が使えます。
          </p>
        </div>
      </section>

      <section className="bg-canvas rounded-card border-hairline space-y-3 border p-6 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <p className="text-ink text-sm font-semibold">4. 値の入り方</p>
        <p className="text-ink-faint text-xs leading-relaxed">
          この項目に値がどこから入るかを決めます。
        </p>

        <div className="border-hairline rounded-control border p-3">
          <p className="text-ink-secondary text-sm">手で入力する ／ 回答フォームから入れる</p>
          <p className="text-ink-faint text-xs leading-relaxed">
            友だち詳細から直接入力するか、回答フォームの登録先に指定すると入ります。
          </p>
        </div>
        {/*
          設計はここに「EC連携から自動で入れる」があり、EC側の項目と突合の
          キーまで選ばせる。列（ec_field_path / ec_is_master）はあるが、
          作るときに指定する受け口が無い。選べる形にすると、選んで保存
          したのに一度も同期されない項目ができる。
        */}
        <div className="border-hairline rounded-control border p-3 opacity-60">
          <p className="text-ink-secondary text-sm">EC連携から自動で入れる（準備中）</p>
          <p className="text-ink-faint text-xs leading-relaxed">
            購入時に入力された情報を取り込む設定です。EC側の項目との突合はこれから入ります。
          </p>
        </div>

        <label className="border-hairline rounded-control flex cursor-pointer items-start gap-3 border p-3">
          <input
            type="checkbox"
            checked={isPersonal}
            onChange={(e) => setIsPersonal(e.target.checked)}
            className="accent-accent mt-0.5"
          />
          <span className="text-ink-secondary text-sm">
            この項目は個人情報として扱う
            <span className="text-ink-faint block text-xs">
              本名・電話番号・住所・生年月日など。閲覧できる権限を絞り、参照した記録をログに残します。
            </span>
          </span>
        </label>
      </section>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            保存して続けて作る
          </button>
          <Link
            href={back ?? '/tags?tab=fields'}
            className="text-ink-secondary bg-canvas-sunken rounded-control px-4 py-2 text-sm font-medium hover:bg-hairline"
          >
            キャンセル
          </Link>
        </div>
      </div>

      {/* 右：どこに出るか */}
      <aside className="space-y-4">
        <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
          <p className="text-ink mb-3 text-sm font-semibold">どこに出るか</p>
          <ul className="space-y-3">
            <li>
              <p className="text-ink-secondary text-sm font-medium">回答フォームの登録先</p>
              <p className="text-ink-faint text-xs">
                {folders.find((f) => f.id === folderId)?.name ?? '未分類'} / {name || '（項目名）'}{' '}
                として選べます
              </p>
            </li>
            <li>
              <p className="text-ink-secondary text-sm font-medium">友だち詳細のタブ</p>
              <p className="text-ink-faint text-xs">
                「{folders.find((f) => f.id === folderId)?.name ?? '基本'}」タブの中に並びます
              </p>
            </li>
            <li>
              <p className="text-ink-secondary text-sm font-medium">テンプレートの差し込み</p>
              <code className="bg-accent-soft text-accent mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs">
                {fieldKey ? `{{field.${fieldKey}}}` : '{{field.…}}'}
              </code>
            </li>
            <li>
              <p className="text-ink-secondary text-sm font-medium">配信の絞り込み条件</p>
              <p className="text-ink-faint text-xs">一斉配信・シナリオの対象条件に使えます</p>
            </li>
          </ul>
        </section>

        <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
          <p className="text-ink mb-2 text-sm font-semibold">気をつけること</p>
          <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
            <li>・項目名はあとから変えられますが、差し込みキーは変わりません</li>
            <li>・選択肢を減らすと、その値が入っている友だちの表示が空欄になります</li>
            <li>・フォルダを移すと、友だち詳細のタブの位置も変わります</li>
          </ul>
        </section>
      </aside>
      </div>
    </div>
  )
}

export default function NewFriendFieldPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewFriendFieldForm />
    </Suspense>
  )
}
