'use client'
import {Copy} from 'lucide-react'
import Select from './select'
import styles from './restaurant-table-header-actions.module.css'

export default function RestaurantTableHeaderActions({canEdit,selectedId,onDuplicate,statusFilter,onStatusFilter}:{canEdit:boolean;selectedId:string;onDuplicate:()=>void;statusFilter:'all'|'active'|'suspended';onStatusFilter:(value:'all'|'active'|'suspended')=>void}){
 return <div className={styles.actions}>{canEdit?<button type="button" className={styles.duplicate} disabled={!selectedId} onClick={onDuplicate}><Copy size={15}/>選択した卓を複製</button>:null}<Select aria-label="卓の表示" value={statusFilter} treatment="text" size="content" width={75} options={[{value:'all',label:'すべて'},{value:'active',label:'有効'},{value:'suspended',label:'停止中'}]} onChange={value=>onStatusFilter(value as 'all'|'active'|'suspended')}/></div>
}
