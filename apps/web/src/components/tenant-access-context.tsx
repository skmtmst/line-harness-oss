'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type TenantStatus = 'active' | 'suspended' | 'archived'

const TenantAccessContext = createContext<TenantStatus>('active')

export function TenantAccessProvider({ status, children }: { status: TenantStatus; children: ReactNode }) {
  return <TenantAccessContext.Provider value={status}>{children}</TenantAccessContext.Provider>
}

export function useTenantStatus(): TenantStatus {
  return useContext(TenantAccessContext)
}
