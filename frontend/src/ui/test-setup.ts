import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library registers its automatic cleanup only when a global afterEach exists.
// Vitest globals are off, so without this each test would see the DOM of the previous one.
afterEach(cleanup)
