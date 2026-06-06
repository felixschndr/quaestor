import '@testing-library/jest-dom/vitest'

// jsdom doesn't provide ResizeObserver, but Radix primitives (e.g. Checkbox)
// rely on it. Provide a no-op shim so they mount.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const hasUsableLocalStorage =
  localStorageDescriptor != null &&
  'value' in localStorageDescriptor &&
  localStorageDescriptor.value != null
if (!hasUsableLocalStorage) {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: false,
    configurable: true,
  })
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    writable: false,
    configurable: true,
  })
}
