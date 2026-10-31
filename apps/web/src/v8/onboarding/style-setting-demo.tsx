'use client'

import { useEffect, useRef, useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { Field, TextInput } from '@/components/shared/form-controls'
import { useInView, useReducedMotion, useTabVisible } from './style-experience-player/use-autoplay'
import styles from './style-setting-demo.module.css'

type Example = { area: string; open: string; field: string; value: string; save: string; steps: string[] }
const reservation = (value: string): Example => ({ area: '予約設定', open: value, field: 'メニュー名', value, save: '変更を保存する', steps: ['予約設定を開く', 'メニューを選ぶ', 'メニュー名を入力する', '変更を保存する'] })
const examples: Record<AccountStyle, Example> = {
  restaurant: { area: '座席・卓管理', open: '卓を作る', field: '表示名', value: '2人卓', save: '追加する', steps: ['座席・卓管理を開く', '卓を作る', '卓番を入力する', '表示名を入力する', '追加する'] },
  salon: reservation('カット'), consult: reservation('初めてのご相談'), standard: reservation('ご相談'),
  lesson: { area: 'イベント予約', open: 'イベントを作る', field: 'イベント名', value: 'ヨガレッスン', save: '下書きを保存', steps: ['イベント予約を開く', 'イベントを作る', 'イベント名などを入力する', '下書きを保存する'] },
  ec: { area: 'タグ', open: 'タグを作る', field: 'タグ名', value: 'リピーター', save: 'タグを作る', steps: ['タグを開く', 'タグを作る', 'タグ名を入力する', '作成を確定する'] },
}

/** 実際の保存は行わない、画面と操作の見本。 */
export default function StyleSettingDemo({ style }: { style: AccountStyle }) {
  const example = examples[style]
  const root = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const inView = useInView(root)
  const visible = useTabVisible()
  const [step, setStep] = useState(0)
  const [manual, setManual] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seenReduced, setSeenReduced] = useState(reduced)
  if (seenReduced !== reduced) { setSeenReduced(reduced); if (reduced) setStep(example.steps.length - 1) }
  useEffect(() => {
    if (reduced || !inView || !visible || paused) return
    const timer = window.setTimeout(() => { setManual(false); setStep(current => (current + 1) % example.steps.length) }, 2800)
    return () => window.clearTimeout(timer)
  }, [step, paused, reduced, inView, visible, example.steps.length])

  const editing = step >= 2
  const saving = step === example.steps.length - 1
  return <section ref={root} className={styles.root} aria-label="設定操作の見本">
    <p className={styles.note}>画面と操作の見本です。実際の入力や保存は行いません。{style === 'lesson' ? '保存にはほかの項目も入力します。' : ''}</p>
    <div className={styles.toolbar}><strong>{example.steps[step]}</strong>{reduced ? <span>自動再生なし</span> : <Button onClick={() => setPaused(value => !value)}>{paused ? '再生する' : '止める'}</Button>}</div>
    <span className={styles.srOnly} aria-live="polite">{manual ? example.steps[step] : ''}</span>
    <div className={styles.stages} role="group" aria-label="操作の場面">{example.steps.map((label, index) => <button type="button" key={`${index}-${label}`} aria-current={index === step ? 'step' : undefined} onClick={() => { setManual(true); setPaused(true); setStep(index) }}>{index + 1}<span className={styles.srOnly}> {label}</span></button>)}</div>
    <Card surface="muted" layout="vertical" padding="default" gap="normal">
      <div className={styles.canvas} aria-hidden="true" inert>
        <div className={`${styles.entry} ${step === 0 ? styles.active : ''}`}>{example.area}</div>
        {step > 0 && <><div className={`${styles.entry} ${step === 1 ? styles.active : ''}`}>{example.open}</div>
          {editing && <div className={styles.form}><strong>{style === 'restaurant' ? '新しい卓' : style === 'lesson' ? 'イベントを作る' : style === 'ec' ? 'タグを作る' : '予約メニューを直す'}</strong>
            {style === 'restaurant' && <div className={step === 2 ? styles.active : ''}><Field label="卓番" required><TextInput value="1" readOnly /></Field></div>}
            <div className={!saving && (style !== 'restaurant' || step === 3) ? styles.active : ''}><Field label={example.field} required><TextInput value={step >= (style === 'restaurant' ? 3 : 2) ? example.value : ''} readOnly /></Field></div>
            <div className={saving ? styles.active : ''}><Button variant="primary">{example.save}</Button></div>
          </div>}</>}
      </div>
    </Card>
  </section>
}
