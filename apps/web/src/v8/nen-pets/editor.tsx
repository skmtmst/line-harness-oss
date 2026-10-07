'use client'

/*
 * ★V8-B ペットの情報を直す（eLjeQ）。真ん中の窓（幅 560・上から 170）。
 * 窓の枠は共通の Dialog。中身は 対象のペット → 種別 → 名前・品種 → 性別 → 誕生日・体重 → 補足。
 * 口は今の画面と同じ（PUT /api/nen-campaigns/pets/:id、版つき保存）。
 * 誕生日を変えると、予約済みの誕生日クーポン配信は新しい誕生日で組み直される（Worker 側）。
 * ほかの人が先に直していたら（409 VERSION_CONFLICT）止めて、入力は残したまま保存し直せる。
 */
import { useState } from 'react'
import { Check } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import Radio from '@/components/shared/radio'
import { TextField } from '@/components/shared/text-field'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ApiError, api } from '@/lib/api'
import type { NenPetRow } from '@/lib/nen-pets-api'
import { normalizeBirthdayInput } from './parts'
import styles from './pets.module.css'

const ANIMALS = [
  { value: 'dog', label: '犬' },
  { value: 'cat', label: '猫' },
  { value: 'other', label: 'その他' },
] as const
const GENDERS = [
  { value: 'male', label: '男の子' },
  { value: 'female', label: '女の子' },
  { value: 'unknown', label: 'わからない' },
] as const

export default function PetEditorV8({ accountId, pet, onClose, onSaved }: {
  accountId: string
  pet: NenPetRow
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(pet.name)
  const [animalType, setAnimalType] = useState<string>(pet.animalType)
  const [gender, setGender] = useState<string>(pet.gender)
  const [birthday, setBirthday] = useState(pet.birthday ?? '')
  const [breed, setBreed] = useState(pet.breed)
  const [weight, setWeight] = useState(pet.weightKg == null ? '' : `${pet.weightKg} kg`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState<string>(pet.updatedAt)

  const save = async () => {
    if (saving) return
    if (!name.trim()) {
      setError('ペットの名前を入れてください。')
      return
    }
    const normalized = normalizeBirthdayInput(birthday)
    if (normalized === 'invalid') {
      setError('誕生日は「2020-03-15」か「03-15」（月日だけ）で入力してください。')
      return
    }
    const weightText = weight.replace(/kg/i, '').trim()
    const weightKg = weightText === '' ? null : Number(weightText)
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0.01 || weightKg > 200)) {
      setError('体重は 0.01〜200kg で入力してください。')
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
        expectedUpdatedAt: version,
      })
      if (!result.success) throw new Error('ペットを保存できませんでした。')
      onSaved()
      onClose()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === 'VERSION_CONFLICT') {
        const latest = (caught.data as { latest?: { updatedAt?: string } } | null)?.latest
        if (latest?.updatedAt) setVersion(latest.updatedAt)
        setError('ほかの人が先にペットの情報を変えました。最新の内容を確認してから、もう一度保存してください。入力した内容はそのまま残っています。')
        onSaved()
        return
      }
      setError(describeApiFailure(caught, 'ペットの保存', {
        forbidden: 'ペットの情報を変える権限がありません。権限を確認してください。',
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      designNode="eLjeQ"
      designWidth={560}
      designTop={170}
      designHeaderPadding="24px 24px 0"
      confirmIcon={<Check size={15} aria-hidden="true" />}
      title="ペットの情報を直す"
      description="間違っている項目を直して保存します。誕生日を変えると、予約済みの誕生日クーポン配信は新しい誕生日で組み直されます。"
      busy={saving}
      error={error}
      confirmLabel="保存する"
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className={styles.editor}>
        <div className={styles.editorPet}>
          <span aria-hidden="true" className={styles.editorFace}>{(pet.name || '?').slice(0, 1)}</span>
          <span className={styles.stack}>
            <span className={styles.cellStrong}>{pet.name || pet.callName}</span>
            <span className={styles.sub}>{`飼い主 ${pet.owner.name}さん・${pet.owner.customerId ? `EC-${pet.owner.customerId}` : 'EC未連携'}`}</span>
          </span>
        </div>
        <div className={styles.editorGroup}>
          <span id="pet-animal-label" className={styles.groupLabel}>種別</span>
          <span className={styles.radioRow} role="radiogroup" aria-labelledby="pet-animal-label">
            {ANIMALS.map((item) => (
              <Radio key={item.value} name="pet-animal" value={item.value} checked={animalType === item.value} onChange={() => setAnimalType(item.value)}>{item.label}</Radio>
            ))}
          </span>
        </div>
        <div className={styles.editorPair}>
          <label className={styles.editorField}>
            <span className={styles.fieldLabel}>ペットの名前</span>
            <TextField aria-label="ペットの名前" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.editorField}>
            <span className={styles.fieldLabel}>品種</span>
            <TextField aria-label="品種" value={breed} maxLength={80} onChange={(event) => setBreed(event.target.value)} />
          </label>
        </div>
        <div className={styles.editorGroup}>
          <span id="pet-gender-label" className={styles.groupLabel}>性別</span>
          <span className={styles.radioRow} role="radiogroup" aria-labelledby="pet-gender-label">
            {GENDERS.map((item) => (
              <Radio key={item.value} name="pet-gender" value={item.value} checked={gender === item.value} onChange={() => setGender(item.value)}>{item.label}</Radio>
            ))}
          </span>
        </div>
        <div className={styles.editorPair}>
          <label className={styles.editorField}>
            <span className={styles.fieldLabel}>誕生日</span>
            <TextField aria-label="誕生日" placeholder="2022-04-03" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
          </label>
          <label className={styles.editorField}>
            <span className={styles.fieldLabel}>体重</span>
            <TextField aria-label="体重" inputMode="decimal" placeholder="9.2 kg" value={weight} onChange={(event) => setWeight(event.target.value)} />
          </label>
        </div>
        <p className={styles.editorHint}>生まれた年が分からないときは「03-15」のように月日だけを入れます。空欄は未登録です。</p>
      </div>
    </Dialog>
  )
}
