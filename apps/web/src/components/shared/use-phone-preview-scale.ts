'use client'
import { useLayoutEffect,useRef,useState } from 'react'
/** 枠の形と文字の比率を保ち、狭いカードにスマホ全体を収める。 */
export function usePhonePreviewScale(enabled:boolean){
 const ref=useRef<HTMLElement>(null),[scale,setScale]=useState(1)
 useLayoutEffect(()=>{
  if(!enabled){setScale(1);return}
  const node=ref.current;if(!node)return
  const measure=()=>{const width=node.getBoundingClientRect().width,phone=node.querySelector<HTMLElement>('[data-line-preview-part="device-frame"]');if(!phone)return;const phoneWidth=Number.parseFloat(getComputedStyle(phone).width);if(width>0&&phoneWidth>0)setScale(Math.min(1,width/phoneWidth))}
  measure();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure)
  observer?.observe(node);return()=>observer?.disconnect()
 },[enabled])
 return {ref,scale}
}
