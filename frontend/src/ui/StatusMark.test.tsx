import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { BaitSiteStatus } from '../core/baitSiteStateMachine'
import StatusMark from './StatusMark'

describe('a valid replay: one mark per status, hidden from screen readers', () => {
  test.each<[BaitSiteStatus, string]>([
    ['EMPTY', 'status-mark--empty'],
    ['ARMED', 'status-mark--armed'],
    ['ACTIVE', 'status-mark--active'],
    ['CAPTURED', 'status-mark--captured'],
    ['LOST', 'status-mark--lost'],
  ])('%s', (status, modifier) => {
    const { container } = render(<StatusMark replay={{ valid: true, status }} />)

    const mark = container.firstElementChild
    expect(container.childElementCount).toBe(1)
    expect(mark?.tagName).toBe('SPAN')
    expect(mark?.classList.contains('status-mark')).toBe(true)
    expect(mark?.classList.contains(modifier)).toBe(true)
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })
})

test('an invalid replay: nothing rendered', () => {
  const { container } = render(<StatusMark replay={{ valid: false, firstInvalidIndex: 1 }} />)

  expect(container.innerHTML).toBe('')
})
