'use client'

import { useState } from 'react'
import { Plus, ListFilter, Ellipsis, Star, CircleDot } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import TextLink from '@/components/shared/text-link'
import { TextField } from '@/components/shared/text-field'
import { Field, TextInput } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import Checkbox from '@/components/shared/checkbox'
import Radio from '@/components/shared/radio'
import Toggle from '@/components/shared/toggle'
import SegmentedControl from '@/components/shared/segmented'
import { Tabs } from '@/components/shared/tabs'
import FilterChip from '@/components/shared/filter-chip'
import OtpInput from '@/components/shared/otp-input'
import DeleteButton from '@/components/shared/delete-button'
import ColorWell from '@/components/shared/color-well'
import styles from './page.module.css'

/** controls レーンの実物部品の確認用。通常メニューには登録しない。 */
export default function V8PartsPage() {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [checkOn, setCheckOn] = useState(true)
  const [checkOff, setCheckOff] = useState(false)
  const [radio, setRadio] = useState('tag')
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [period, setPeriod] = useState('today')
  const [tab, setTab] = useState(0)
  const [filterOn, setFilterOn] = useState(true)
  const [filterOff, setFilterOff] = useState(false)
  const [otp, setOtp] = useState('48')
  const [success, setSuccess] = useState('482917')
  const [color, setColor] = useState('#06c755')
  const [deleted, setDeleted] = useState(false)
  const parts: [string, React.ReactNode][] = [
    ['doYdE', <Button key="doYdE" variant="primary"><Plus size={15} aria-hidden="true" />保存する</Button>],
    ['u101P', <Button key="u101P">キャンセル</Button>],
    ['LrB2L', <Button key="LrB2L" variant="danger">削除する</Button>],
    ['wDPmk', <Button key="wDPmk" variant="text"><ListFilter size={15} aria-hidden="true" />詳細条件</Button>],
    ['KspUx', <IconButton key="KspUx" aria-label="その他の操作"><Ellipsis size={16} aria-hidden="true" /></IconButton>],
    ['g5Db8', <TextLink key="g5Db8" href="/inbox">受信箱を開く</TextLink>],
    ['Ume2U', <div key="Ume2U" className={styles.inputWidth}><Field label="配信の名前" htmlFor="parts-name"><TextField id="parts-name" placeholder="例：秋の新商品のお知らせ" value={text} onChange={(e) => setText(e.target.value)} /></Field></div>],
    ['wMMk6', <Select key="wMMk6" className={styles.selectWidth} aria-label="タグ" value="all" options={[{ value: 'all', label: 'タグ：すべて' }]} onChange={() => undefined} />],
    ['TkVyB', <SearchField key="TkVyB" className={styles.inputWidth} aria-label="名前・タグ・メモで探す" placeholder="名前・タグ・メモで探す" value={search} onChange={setSearch} onClear={() => setSearch('')} />],
    ['dQCCN', <Checkbox key="dQCCN" checked={checkOn} onCheckedChange={setCheckOn}>ブロック中の人を除く</Checkbox>],
    ['S9U7v', <Checkbox key="S9U7v" checked={checkOff} onCheckedChange={setCheckOff}>この1週間に送った人を除く</Checkbox>],
    ['y4YQSB', <Radio key="y4YQSB" name="parts-radio" checked={radio === 'tag'} onChange={() => setRadio('tag')}>タグで絞る</Radio>],
    ['gzxYf', <Radio key="gzxYf" name="parts-radio" checked={radio === 'all'} onChange={() => setRadio('all')}>すべての友だち</Radio>],
    ['bkjTv', <Toggle key="bkjTv" checked={on} label="有効" onChange={setOn} />],
    ['LxHpj', <Toggle key="LxHpj" checked={off} label="通知" onChange={setOff} />],
    ['dtJVi', <SegmentedControl key="dtJVi" aria-label="期間" options={[{ value: 'today', label: '今日' }, { value: '7', label: '過去7日' }, { value: '28', label: '過去28日' }]} value={period} onChange={setPeriod} />],
    ['clV5c', <Tabs key="clV5c" className={styles.tabsWidth} label="友だち" items={['友だち一覧', '重複検出', '統合ユーザー', 'UID移行'].map((label, index) => ({ label, current: tab === index, onClick: () => setTab(index) }))} />],
    ['O2fCAt', <FilterChip key="O2fCAt" selected={filterOff} onChange={setFilterOff} icon={<Star size={13} aria-hidden="true" />}>注目のみ</FilterChip>],
    ['XGJDa', <FilterChip key="XGJDa" selected={filterOn} onChange={setFilterOn} icon={<CircleDot size={13} aria-hidden="true" />}>未対応</FilterChip>],
    ['RfHCo', <OtpInput key="RfHCo" visualLabel="認証コード（6桁）" label="入力中の認証コード" value={otp} onChange={setOtp} />],
    ['cMbie', <OtpInput key="cMbie" visualLabel="認証コード（6桁）" label="確認済みの認証コード" value={success} onChange={setSuccess} success />],
    ['prbOC', <DeleteButton key="prbOC" label="通常の削除" onConfirm={() => setDeleted(true)} />],
    ['zopvP', <DeleteButton key="zopvP" label="確認中の削除" onConfirm={() => setDeleted(true)} />],
    ['KVkPg', <ColorWell key="KVkPg" value={color} onChange={setColor} label="閉じた色選び" />],
    ['mpJVS', <ColorWell key="mpJVS" value={color} onChange={setColor} label="開いた色選び" />],
  ]
  return (
    <div className={styles.page}>
      <h1>V8 共通部品の確認：controls</h1>
      <p>各欄には実際の共通部品を置いています。テーマは管理画面の設定に従います。</p>
      {parts.map(([id, part]) => <section key={id} className={styles.section}><h2>{id}</h2><div data-part-id={id} className={styles.sample}>{part}</div></section>)}
      <section className={styles.section}><h2>入力欄の別の呼び出し方</h2><div className={styles.inputWidth}><Field label="配信の名前" htmlFor="parts-form-input"><TextInput id="parts-form-input" placeholder="例：秋の新商品のお知らせ" /></Field></div></section>
      <p role="status">{deleted ? '確認ボタンを押しました（確認ページでは実データを削除しません）' : ''}</p>
    </div>
  )
}
