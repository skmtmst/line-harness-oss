'use client'

import type { AccountStyle } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { Field, TextInput } from '@/components/shared/form-controls'
import { Steps } from '@/components/templates/steps'
import { RestaurantFollowupDemo } from '@/v8/restaurant/line-followup/public/demo'
import { STYLE_EXPERIENCE_SCRIPT, StyleExperiencePlayer } from './style-experience-player'
import StyleChooseAction from './style-choose-action'
import StyleSettingDemo from './style-setting-demo'
import styles from './style-demo-pages.module.css'

const labels = ['できること', '設定のしかた', 'よく使う操作', '使い始めた後', 'musubo ならでは'] as const
const content: Record<AccountStyle, { setting: string; operation: string; after: string; feature: string }> = {
  restaurant: { setting: '席と卓を登録し、人数に合わせた予約を受けます。', operation: '予約の前日や来店後の案内を用意します。', after: '予約を確認し、来店を記録します。', feature: '席・人数・コースに合わせたお店の見本から始められます。' },
  salon: { setting: 'メニューと担当者、受付時間を設定します。', operation: '担当ごとの予定を確認します。', after: '来店を記録し、次のご案内に備えます。', feature: '担当とメニューに合わせた見本から始められます。' },
  consult: { setting: '相談のメニューと受付時間を設定します。', operation: 'オンラインまたは対面の予約を受けます。', after: '面談の結果を確認し、次のご案内に備えます。', feature: '相談の予定と結果待ちをまとめて確認できます。' },
  lesson: { setting: 'イベント予約を使う場合は、受付の予定を設定します。', operation: 'クラスの予定と出席を確認します。', after: 'レッスンの出席を記録します。', feature: 'クラスと出欠に合わせた見本から始められます。' },
  standard: { setting: '予約機能を有効にした場合は、予約メニューや受付枠を設定できます。', operation: 'お知らせを作る', after: 'お問い合わせを受信箱で確認し、担当者が返事します。', feature: '使い方に合わせた見本と画面から始められます。' },
  ec: { setting: 'お客様を分類するタグを作れます。', operation: '商品の案内を用意します。', after: '注文の数とお問い合わせを確認します。', feature: 'お店の注文とLINEでのやり取りを確認できます。' },
}

export default function StyleDemoPages({ viewing, page, onPage, chosen, onChoose, disabled }: {
  viewing: AccountStyle; page: number; onPage: (index: number) => void; chosen: AccountStyle | null
  onChoose: (style: AccountStyle) => void; disabled: boolean
}) {
  const look = STYLE_EXPERIENCE_SCRIPT.styles[viewing]
  const text = content[viewing]
  const message = page === 1 ? text.setting : page === 2 ? text.operation : page === 3 ? text.after : text.feature
  return <section className={styles.root} aria-label={`${look.label}のデモ`}>
    <Steps label="デモのページ" currentKey={String(page)} steps={labels.map((label, index) => ({
      key: String(index), label, state: index === page ? 'current' : index < page ? 'done' : 'todo', reachable: true, onSelect: () => onPage(index),
    }))} />
    <div aria-live="polite"><p className={styles.counter}>{`${page + 1} / ${labels.length}`}</p><h3 className={styles.heading}>{labels[page]}</h3></div>
    <div className={styles.choose}><StyleChooseAction viewing={viewing} chosen={chosen} onChoose={onChoose} disabled={disabled} primary /></div>
    {page === 0 ? <>
      <ul className={styles.can}>{look.can.map(item => <li key={item.text}>{item.text}</li>)}</ul>
      <StyleExperiencePlayer script={STYLE_EXPERIENCE_SCRIPT} style={viewing} switcher="external" variant="minimal" data="sample" />
    </> : <>
      <p className={styles.description}>{message}</p>
      {page === 1 ? <StyleSettingDemo key={viewing} style={viewing} /> : page === 2 && viewing === 'restaurant'
        ? <RestaurantFollowupDemo />
        : page === 2 && viewing === 'standard' ? <Card surface="muted" layout="vertical" padding="default" gap="normal" aria-label="お知らせの見本">
          <strong>一斉配信</strong><Field label="本文"><TextInput value="営業時間のお知らせ" readOnly /></Field><p className={styles.note}>お知らせの文の見本です。</p>
        </Card> : <Card surface="muted" layout="vertical" padding="default" gap="normal" aria-label="使い方の見本">
          <strong>{page === 1 ? '設定の見本' : page === 2 ? text.operation : page === 3 ? '利用の流れ' : '基本の機能'}</strong>
          <p className={styles.description}>{page === 4 ? '配信・タグ・自動応答などの基本も使えます。' : message}</p>
        </Card>}
      {page === 2 && viewing === 'restaurant' ? <p className={styles.note}>設定のない状態の見本です。実際の初期セットとは異なります。送り始めるには設定・公開・承認が必要です。</p> : null}
    </>}
    <div className={styles.navigation}>
      <Button onClick={() => { if (page > 0) onPage(page - 1) }} aria-disabled={page === 0}>前のページ</Button>
      <Button onClick={() => { if (page < labels.length - 1) onPage(page + 1) }} aria-disabled={page === labels.length - 1}>次のページ</Button>
    </div>
  </section>
}
