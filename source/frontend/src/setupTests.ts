import '@testing-library/jest-dom/vitest'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

if (!('__virtualSizePatched' in Element.prototype)) {
  Object.defineProperty(Element.prototype, '__virtualSizePatched', { value: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 64,
      width: 800,
      height: 64,
      toJSON() {},
    }
  }
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
