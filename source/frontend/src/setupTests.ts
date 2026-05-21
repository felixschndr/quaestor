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
