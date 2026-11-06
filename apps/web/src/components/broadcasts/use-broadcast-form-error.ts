import { useCallback, useState, type SetStateAction } from 'react'

export function useBroadcastFormError() {
  const [state, setState] = useState({ message: '', validation: false })
  const setError = useCallback((value: SetStateAction<string>) => {
    setState(previous => ({
      message: typeof value === 'function' ? value(previous.message) : value,
      validation: false,
    }))
  }, [])
  const setValidationError = useCallback((message: string) => {
    setState({ message, validation: true })
  }, [])
  const resolveValidationError = useCallback((problem: string) => {
    setState(previous => previous.validation && previous.message !== problem
      ? { message: '', validation: false }
      : previous)
  }, [])
  return { error: state.message, setError, setValidationError, resolveValidationError }
}
