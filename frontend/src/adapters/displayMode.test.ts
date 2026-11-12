import { describe, expect, it, vi } from 'vitest'
import { isInstalledApp } from './displayMode'

const notStandalone = (_query: string) => ({ matches: false })

describe('isInstalledApp', () => {
  it('is true when the standalone display mode matches', () => {
    const matchMedia = vi.fn((_query: string) => ({ matches: true }))

    expect(isInstalledApp({ matchMedia, navigator: {} })).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(display-mode: standalone)')
  })

  it('is true when navigator.standalone is true (iOS Safari)', () => {
    expect(isInstalledApp({ matchMedia: notStandalone, navigator: { standalone: true } })).toBe(true)
  })

  it('is false when neither says so', () => {
    expect(isInstalledApp({ matchMedia: notStandalone, navigator: {} })).toBe(false)
    expect(isInstalledApp({ matchMedia: notStandalone, navigator: { standalone: false } })).toBe(false)
  })

  it('works without matchMedia (jsdom)', () => {
    expect(isInstalledApp({ navigator: {} })).toBe(false)
    expect(isInstalledApp({ navigator: { standalone: true } })).toBe(true)
  })
})
