'use client'

import { TextField } from '@/components/shared/text-field'
import { DuplicateNameNote } from '@/components/friend-fields/attribute-kind-guide'
import styles from './create.module.css'

const COLORS = [
  { value: '#EF4B55', name: '赤' },
  { value: '#B86A00', name: 'オレンジ' },
  { value: '#06C755', name: '緑' },
  { value: '#2563D4', name: '青' },
  { value: '#6B56CF', name: '紫' },
  { value: '#707981', name: 'グレー' },
] as const

export default function MarkBasicFields({ name, color, onName, onColor, nameDuplicates = [], disabled = false, error }: { name: string; color: string; onName: (name: string) => void; onColor: (color: string) => void; nameDuplicates?: string[]; disabled?: boolean; error?: string }) {
  return (
            <section className={styles.card} aria-labelledby="mark-basic">
              <div className={styles.cardHead}><h2 className={styles.cardTitle} id="mark-basic">基本</h2></div>
              <label className={styles.field}>
                <span className={styles.label}>マーク名</span>
                <TextField invalid={Boolean(error)} disabled={disabled} className={styles.input} value={name} onChange={(event) => onName(event.target.value)} placeholder="例：要確認" />
                {error ? <p role="alert" className={styles.fieldError}>{error}</p> : null}
                <DuplicateNameNote duplicates={nameDuplicates} kindLabel="対応マーク" />
              </label>
              <div className={styles.colorField} role="group" aria-labelledby="mark-color">
                <span className={styles.labelStrong} id="mark-color">色</span>
                <span className={styles.colorRow}>
                  {COLORS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => onColor(item.value)}
                      aria-label={item.name}
                      title={item.name}
                      aria-pressed={color.toLowerCase() === item.value.toLowerCase()}
                      className={styles.colorSwatch}
                      style={{ backgroundColor: item.value }}
                    />
                  ))}
                </span>
                <p className={styles.keyNote}>赤・オレンジ・緑・青・紫・グレー（色と名前の両方で見分ける）</p>
              </div>
            </section>
  )
}
