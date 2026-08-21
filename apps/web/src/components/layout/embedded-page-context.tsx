'use client'

import { createContext, useContext, type ReactNode } from 'react'

const EmbeddedPageContext = createContext(false)

export function EmbeddedPageProvider({ children }: { children: ReactNode }) {
  return <EmbeddedPageContext.Provider value>{children}</EmbeddedPageContext.Provider>
}

export function useEmbeddedPage() {
  return useContext(EmbeddedPageContext)
}
