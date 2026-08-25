import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom has no layout and therefore no scrolling; its stub prints "Not
// implemented: Window's scrollTo()" for every call. Contract.tsx scrolls to the
// top on mount, so without this every contract test drags that noise along.
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
})
