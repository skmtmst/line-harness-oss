'use client'
import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import Dialog from './dialog'
import Checkbox from './checkbox'
import SearchField from './search-field'
import Card from './card'
import Notice from './notice'
import { ReorderHandle, RowMenu, useReorder } from './row-actions'
import styles from './display-items-dialog.module.css'
export type DisplayItem = {key: string; label: string; group: string}

/** 一覧と顧客情報の欄が共通で使う。取消では保存せず、順序は選んだ順。 */
export default function DisplayItemsDialog({title = '表示項目を編集', items, selected, maxSelected, manageHref, presentation, onCancel, onConfirm}: {
  title?: string; items: DisplayItem[]; selected: string[]; maxSelected?: number;
  manageHref?: string; onCancel: () => void; onConfirm: (keys: string[]) => void;
  presentation?: 'columns';
}) {
  const limitId = useId()
  const ChosenFrame = presentation === 'columns' ? Card : 'div'
  const [keys, setKeys] = useState(() => selected.filter(key => items.some(item => item.key === key)))
  const [search, setSearch] = useState('')
  const chosen = keys.map(key => items.find(item => item.key === key)!).filter(Boolean)
  const reorder = useReorder({items: chosen, idOf: item => item.key, onReorder: change => setKeys(change.ids)})
  const available = items.filter(item => !keys.includes(item.key) && `${item.label} ${item.group}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const groups = useMemo(() => [...new Set(available.map(item => item.group))], [available])
  const full = maxSelected !== undefined && chosen.length >= maxSelected
  return <Dialog open title={title} size="medium" contentLayout="form" onCancel={onCancel} onConfirm={() => onConfirm(chosen.map(item => item.key))} confirmLabel="保存する"
    confirmDisabled={maxSelected !== undefined && chosen.length > maxSelected} confirmDisabledReason={full ? '選択数が上限を超えています。別の項目を外してから保存してください。' : undefined}>
    <div className={styles.body} data-presentation={presentation}>
      <p className={styles.note}>{maxSelected === undefined ? '選んだ項目は、つまみで並べ替えられます。' : `友だちの名前はいつも表示します。ほかは${maxSelected}列まで選べます。`}</p>
      <h3 className={styles.heading}>{presentation === 'columns' ? 'いま出している列' : '表示する項目'}（{chosen.length}{maxSelected === undefined ? '' : ` / ${maxSelected}`}）</h3>
      <ChosenFrame {...(presentation === 'columns' ? { padding: 'rows' as const, surface: 'bordered' as const } : {})} className={styles.chosen} aria-label="選択した列">
        {presentation === 'columns' ? <div className={styles.fixedRow} data-fixed-display-name><span><Lock size={16} role="img" aria-label="いつも表示する列" />友だち（名前）</span><span>いつも出ます</span></div> : null}
        {chosen.map(item => <div key={item.key} className={styles.row} {...reorder.rowProps(item.key)}>
          <ReorderHandle label={item.label} {...reorder.handleProps(item.key)} onMove={direction => reorder.moveBy(item.key, direction)} />
          <Checkbox checked onCheckedChange={() => setKeys(current => current.filter(key => key !== item.key))}>{item.label}</Checkbox>
          <RowMenu label={`${item.label}の順序`} items={reorder.menuItems(item.key)} />
        </div>)}
        {!chosen.length ? <p className={styles.note}>下から表示する項目を選んでください</p> : null}
      </ChosenFrame>
      <SearchField aria-label="表示項目を検索" value={search} onChange={setSearch} placeholder="項目名・分類で探す" />
      {full ? presentation === 'columns' ? <Notice id={limitId} role="status" tone="info">上限に達しました。別の項目を外してから選んでください。</Notice> : <p id={limitId} role="status" className={styles.note}>上限に達しました。別の項目を外してから選んでください。</p> : null}
      <div className={styles.available}>
        {maxSelected !== undefined ? <h3 className={styles.heading}>お店が作った情報欄（{items.filter(item => item.key.startsWith('field:')).length}）</h3> : null}
        {groups.map(group => <section key={group}><h3 className={styles.heading}>{group}</h3><div className={styles.options} role="group" aria-label={`${group}の追加できる列`}>
          {available.filter(item => item.group === group).map(item => <div key={item.key} className={styles.row}>
            <Checkbox checked={false} disabled={full} aria-describedby={full ? limitId : undefined} onCheckedChange={() => setKeys(current => [...current, item.key])}>{item.label}</Checkbox>
          </div>)}
        </div></section>)}
        {!available.length ? <p className={styles.note}>{search ? '一致する項目がありません' : '追加できる項目はありません'}</p> : null}
        {maxSelected !== undefined && !items.some(item => item.key.startsWith('field:')) && manageHref ? <p className={styles.note}>まだありません。<Link href={manageHref} onClick={onCancel}>情報欄を作る</Link></p> : null}
      </div>
      {manageHref ? <Link href={manageHref} onClick={onCancel}>情報欄を管理</Link> : null}
    </div>
  </Dialog>
}
