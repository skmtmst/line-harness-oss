'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Dialog from './dialog'
import Checkbox from './checkbox'
import SearchField from './search-field'
import { ReorderHandle, RowMenu, useReorder } from './row-actions'
import styles from './display-items-dialog.module.css'
export type DisplayItem = {key: string; label: string; group: string}

/** 一覧と顧客情報の欄が共通で使う。取消では保存せず、順序は選んだ順。 */
export default function DisplayItemsDialog({title = '表示項目を編集', items, selected, maxSelected, manageHref, onCancel, onConfirm}: {
  title?: string; items: DisplayItem[]; selected: string[]; maxSelected?: number;
  manageHref?: string; onCancel: () => void; onConfirm: (keys: string[]) => void;
}) {
  const [keys, setKeys] = useState(() => selected.filter(key => items.some(item => item.key === key)))
  const [search, setSearch] = useState('')
  const chosen = keys.map(key => items.find(item => item.key === key)!).filter(Boolean)
  const reorder = useReorder({items: chosen, idOf: item => item.key, onReorder: change => setKeys(change.ids)})
  const available = items.filter(item => !keys.includes(item.key) && `${item.label} ${item.group}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const groups = useMemo(() => [...new Set(available.map(item => item.group))], [available])
  const full = maxSelected !== undefined && keys.length >= maxSelected
  return <Dialog open title={title} size="medium" onCancel={onCancel} onConfirm={() => onConfirm(keys)} confirmLabel="保存する"
    confirmDisabled={maxSelected !== undefined && keys.length > maxSelected}>
    <div className={styles.body}>
      <p className={styles.note}>{maxSelected === undefined ? '選んだ項目は、つまみで並べ替えられます。' : `友だちの名前はいつも表示します。ほかは${maxSelected}列まで選べます。`}</p>
      <h3 className={styles.heading}>表示する項目（{keys.length}{maxSelected === undefined ? '' : ` / ${maxSelected}`}）</h3>
      <div className={styles.chosen}>
        {chosen.map(item => <div key={item.key} className={styles.row} {...reorder.rowProps(item.key)}>
          <ReorderHandle label={item.label} {...reorder.handleProps(item.key)} onMove={direction => reorder.moveBy(item.key, direction)} />
          <Checkbox checked onCheckedChange={() => setKeys(current => current.filter(key => key !== item.key))}>{item.label}</Checkbox>
          <RowMenu label={`${item.label}の順序`} items={reorder.menuItems(item.key)} />
        </div>)}
        {!chosen.length ? <p className={styles.note}>下から表示する項目を選んでください</p> : null}
      </div>
      <SearchField aria-label="表示項目を検索" value={search} onChange={setSearch} placeholder="項目名・分類で探す" />
      {full ? <p role="status" className={styles.note}>上限に達しました。別の項目を外してから選んでください。</p> : null}
      <div className={styles.available}>
        {groups.map(group => <section key={group}><h3 className={styles.heading}>{group}</h3>
          {available.filter(item => item.group === group).map(item => <div key={item.key} className={styles.row}>
            <Checkbox checked={false} disabled={full} onCheckedChange={() => setKeys(current => [...current, item.key])}>{item.label}</Checkbox>
          </div>)}
        </section>)}
        {!available.length ? <p className={styles.note}>{search ? '一致する項目がありません' : '追加できる項目はありません'}</p> : null}
        {!items.some(item => item.key.startsWith('field:')) && manageHref ? <p className={styles.note}>お店が作った情報欄はまだありません。</p> : null}
      </div>
      {manageHref ? <Link href={manageHref} onClick={onCancel}>情報欄を管理</Link> : null}
    </div>
  </Dialog>
}
