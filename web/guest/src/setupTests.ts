import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom has no layout and therefore no scrolling; its stub prints "Not
// implemented: Window's scrollTo()" for every call. Contract.tsx scrolls to the
// top on mount, so without this every contract test drags that noise along.
window.scrollTo = () => {}
// Same story for scrollIntoView, which jsdom does not implement at all: the
// contract screen scrolls to whatever a failed attempt to send is complaining
// about.
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
})
