'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { api, ApiError } from '@/lib/api'
import type { NenPetRow } from '@/lib/nen-pets-api'

/**
 * 誕生日は年月日（2020-03-15）か月日だけ（03-15）を受け付ける。
 * 生まれた年が分からない子も誕生日配信の対象にするため。未登録は空のまま。
 */
export function normalizeBirthdayInput(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{2}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return 'invalid'
}

/** 月日だけ（MM-DD）の誕生日は「3/15」の形で見せる。 */
export function birthdayDraft(birthday: string | null): string {
  return birthday ?? ''
}

/**
 * マイペット一覧の行から開く編集ドロワー。
 * 誤登録を消して作り直さなくて済むよう、名前・種別・性別・誕生日・品種・体重を
 * アカウント権限つきの口（PUT /api/nen-campaigns/pets/:id）で直す。
 * 誕生日を変えると、古い日付へ予約済みの誕生日クーポン配信は取り消され、
 * 次の日次処理で新しい誕生日から組み直される。
 */
export default function PetEditor({ accountId, pet, onClose, onSaved }: {
  accountId: string
  pet: NenPetRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [animalType, setAnimalType] = useState('dog')
  const [gender, setGender] = useState('unknown')
  const [birthday, setBirthday] = useState('')
  const [breed, setBreed] = useState('')
  const [weight, setWeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!pet) return
    setName(pet.name)
    setAnimalType(pet.animalType)
    setGender(pet.gender)
    setBirthday(birthdayDraft(pet.birthday))
    setBreed(pet.breed)
    setWeight(pet.weightKg == null ? '' : String(pet.weightKg))
    setError('')
  }, [pet])

  const save = async () => {
    if (!pet || saving) return
    const normalized = normalizeBirthdayInput(birthday)
    if (normalized === 'invalid') {
      setError('誕生日は「2020-03-15」か「03-15」（月日だけ）で入力してください。')
      return
    }
    const weightKg = weight.trim() === '' ? null : Number(weight)
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 200)) {
      setError('体重は 0.1〜200kg で入力してください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await api.nenCampaigns.updatePet(accountId, pet.id, {
        name: name.trim(),
        animalType,
        gender,
        birthday: normalized ?? '',
        breed: breed.trim(),
        weightKg,
      })
      if (!result.success) throw new Error('ペットを保存できませんでした。')
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ペットを保存できませんでした。通信の状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={pet !== null}
      title="ペットの情報を直す"
      description="間違っている項目を直して保存します。誕生日を変えると、予約済みの誕生日クーポン配信は新しい誕生日で組み直されます。"
      busy={saving}
      error={error}
      onClose={onClose}
      footer={(
        <Button type="button" variant="primary" disabled={saving || !name.trim()} onClick={() => void save()}>
          {saving ? '保存しています…' : '保存する'}
        </Button>
      )}
    >
      <div className="grid gap-4">
        <label className="grid gap-1 text-caption font-bold text-ink">
          名前
          <TextField aria-label="ペットの名前" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <Select
          aria-label="種別"
          label="種別"
          value={animalType}
          onChange={setAnimalType}
          options={[
            { value: 'dog', label: '犬' },
            { value: 'cat', label: '猫' },
            { value: 'other', label: 'その他' },
          ]}
        />
        <Select
          aria-label="性別"
          label="性別"
          value={gender}
          onChange={setGender}
          options={[
            { value: 'male', label: '男の子' },
            { value: 'female', label: '女の子' },
            { value: 'unknown', label: 'わからない' },
          ]}
        />
        <label className="grid gap-1 text-caption font-bold text-ink">
          誕生日
          <TextField
            aria-label="誕生日"
            placeholder="2020-03-15 または 03-15（月日だけ）"
            value={birthday}
            onChange={(event) => setBirthday(event.target.value)}
          />
          <span className="text-micro font-normal text-ink-faint">生まれた年が分からないときは「03-15」のように月日だけを入れます。空欄は未登録です。</span>
        </label>
        <label className="grid gap-1 text-caption font-bold text-ink">
          品種（任意）
          <TextField aria-label="品種" value={breed} onChange={(event) => setBreed(event.target.value)} maxLength={80} />
        </label>
        <label className="grid gap-1 text-caption font-bold text-ink">
          体重 kg（任意）
          <TextField aria-label="体重" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} />
        </label>
      </div>
    </Drawer>
  )
}
