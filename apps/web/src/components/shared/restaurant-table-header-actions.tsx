'use client'
import Select from './select'
import styles from './restaurant-table-header-actions.module.css'

export default function RestaurantTableHeaderActions({statusFilter,onStatusFilter}:{statusFilter:'all'|'active'|'suspended';onStatusFilter:(value:'all'|'active'|'suspended')=>void}){
 return <div className={styles.actions}><Select aria-label="卓の表示" value={statusFilter} size="content" width={96} options={[{value:'all',label:'すべて'},{value:'active',label:'受付中'},{value:'suspended',label:'停止中'}]} onChange={value=>onStatusFilter(value as 'all'|'active'|'suspended')}/></div>
}
