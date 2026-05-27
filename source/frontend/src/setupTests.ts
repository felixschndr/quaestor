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

// jsdom under Node 26 doesn't expose localStorage out of the box — install a
// minimal in-memory shim so code that reads/writes localStorage (e.g. the
// theme bootstrap) works in tests.
if (typeof globalThis.localStorage === 'undefined') {
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
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: false })
  Object.defineProperty(window, 'localStorage', { value: storage, writable: false })
}
