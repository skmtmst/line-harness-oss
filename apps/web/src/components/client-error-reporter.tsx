'use client'

import { useEffect } from 'react'
import { reportClientRuntimeError } from '@/lib/client-error-reporting'

export default function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      void reportClientRuntimeError(event.error || event.message, 'window.error').catch(() => undefined)
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      void reportClientRuntimeError(event.reason, 'unhandledrejection').catch(() => undefined)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])
  return null
}
