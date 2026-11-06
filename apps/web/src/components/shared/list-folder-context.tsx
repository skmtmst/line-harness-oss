'use client'

import { createContext } from 'react'

/** The list template owns folder capability, including when its rail is collapsed. */
export const ListFolderContext = createContext<boolean | null>(null)
