'use client'
import {useEffect, useState} from 'react'
import {type CustomerLook} from '@line-crm/shared'
import {api} from '@/lib/api'
export function useCustomerLook(accountId: string | null) {
 const [look,setLook]=useState<CustomerLook | null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{let active=true;setLook(null);setError('');if(!accountId)return;
  api.accountSettings.getCustomerLook(accountId).then(result=>{if(!active)return;if(!result.success)throw new Error();setLook(result.data.look)}).catch(()=>{if(active)setError('店のデザインを読み込めませんでした')});
  return ()=>{active=false}
 },[accountId]);return {look,error}
}
