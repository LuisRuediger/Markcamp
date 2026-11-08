import type { Logger } from '../core/ports'

export function createConsoleLogger(): Logger {
  return {
    error(message) {
      console.error(message)
    },
    warn(message) {
      console.warn(message)
    },
  }
}
