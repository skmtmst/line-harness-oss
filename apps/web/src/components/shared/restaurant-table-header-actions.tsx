'use client'
import {Copy} from 'lucide-react'
import styles from './restaurant-table-header-actions.module.css'

export default function RestaurantTableHeaderActions({canEdit,selectedId,onDuplicate,statusFilter,onStatusFilter}:{canEdit:boolean;selectedId:string;onDuplicate:()=>void;statusFilter:'all'|'active'|'suspended';onStatusFilter:(value:'all'|'active'|'suspended')=>void}){
 return <div className={styles.actions}>{canEdit?<button type="button" className={styles.duplicate} disabled={!selectedId} onClick={onDuplicate}><Copy size={15}/>選択した卓を複製</button>:null}<select aria-label="卓の表示" value={statusFilter} onChange={e=>onStatusFilter(e.target.value as 'all'|'active'|'suspended')}><option value="all">すべて</option><option value="active">有効</option><option value="suspended">停止中</option></select></div>
}
