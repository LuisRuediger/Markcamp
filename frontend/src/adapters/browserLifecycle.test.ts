import { expect, test, vi } from 'vitest'
import { createBrowserLifecycle } from './browserLifecycle'

/** A separate document whose visibilityState the test sets (jsdom's own is read-only). */
function documentWithVisibility() {
  const doc = document.implementation.createHTMLDocument()
  let state: DocumentVisibilityState = 'visible'
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => state })
  return {
    doc,
    change(next: DocumentVisibilityState) {
      state = next
      doc.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

test('23. online calls the listener until unsubscribed', () => {
  const lifecycle = createBrowserLifecycle(window, documentWithVisibility().doc)
  const listener = vi.fn()
  const unsubscribe = lifecycle.onOnline(listener)

  window.dispatchEvent(new Event('online'))
  expect(listener).toHaveBeenCalledOnce()

  unsubscribe()
  window.dispatchEvent(new Event('online'))
  expect(listener).toHaveBeenCalledOnce()
})

test('23b. visibilitychange calls the foreground listener only when visible, until unsubscribed', () => {
  const visibility = documentWithVisibility()
  const lifecycle = createBrowserLifecycle(window, visibility.doc)
  const listener = vi.fn()
  const unsubscribe = lifecycle.onForeground(listener)

  visibility.change('hidden')
  expect(listener).not.toHaveBeenCalled()
  visibility.change('visible')
  expect(listener).toHaveBeenCalledOnce()

  unsubscribe()
  visibility.change('hidden')
  visibility.change('visible')
  expect(listener).toHaveBeenCalledOnce()
})
