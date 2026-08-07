import { useCallback, useEffect, useState } from 'react'

import { safeStorage } from './storage'

export const STORAGE_KEY = 'privacyMode'

const store = safeStorage(STORAGE_KEY, 'local')

export function usePrivacyMode() {
  const [hidden, setHidden] = useState(() => store.read() === 'on')

  useEffect(() => {
    if (hidden) document.documentElement.dataset.privacy = 'on'
    else delete document.documentElement.dataset.privacy
  }, [hidden])

  const toggle = useCallback(() => {
    setHidden((prev) => {
      store.write(prev ? null : 'on')
      return !prev
    })
  }, [])

  return { hidden, toggle }
}
