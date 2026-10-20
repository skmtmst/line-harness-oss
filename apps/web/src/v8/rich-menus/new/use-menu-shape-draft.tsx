'use client'

import { useState } from 'react'
import { type PendingImage } from './create-types'

export function useMenuShapeDraft() {
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [folderId, setFolderId] = useState('')
  const [size, setSize] = useState<'large' | 'compact'>('large')
  const [tabCount, setTabCount] = useState(0)
  const [templateKey, setTemplateKey] = useState('large-2x3')
  const [pendingImages, setPendingImages] = useState<Array<PendingImage | null>>([])
  const [tabNames, setTabNames] = useState<string[]>([])
  const [pendingTabCount, setPendingTabCount] = useState<number | null>(null)
  return { name, setName, chatBarText, setChatBarText, folderId, setFolderId, size, setSize, tabCount, setTabCount, templateKey, setTemplateKey, pendingImages, setPendingImages, tabNames, setTabNames, pendingTabCount, setPendingTabCount }
}
