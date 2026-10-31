import type { ReactNode } from 'react'
/** 縮小しない画面では、スマホのDOMをそのまま保つ。 */
export function PhonePreviewScale({enabled,scale,children}:{enabled:boolean;scale:number;children:ReactNode}){
 return enabled?<div style={{zoom:scale}}>{children}</div>:children
}
