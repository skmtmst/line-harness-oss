import type {ReactNode} from 'react'
import styles from './restaurant-floor-panel.module.css'

export default function RestaurantFloorPanel({children}:{children:ReactNode}){
 return <div className={styles.floorPanel}>{children}</div>
}
