import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { toHistoryInstant } from '../core/historyOrder'
import type { LocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import type { GeoReading } from '../core/ports'
import { createFakeGeolocation } from './fakeGeolocation'
import { ptBR } from './i18n/pt-BR'
import NewSiteScreen from './NewSiteScreen'

const P = 'p-1'

function reading(accuracyM: number, latitude = -27.1, longitude = -49.1): GeoReading {
  return { latitude, longitude, accuracyM }
}

function setup() {
  const geo = createFakeGeolocation()
  const createBaitSite = vi.fn<LocalCommands['createBaitSite']>(async () => 'queued')
  const onBack = vi.fn<() => void>()
  const onSaved = vi.fn<() => void>()
  const { unmount } = render(
    <NewSiteScreen
      projectId={P}
      suggestedName="Isca 3"
      geolocation={geo.port}
      commands={{ createBaitSite }}
      onBack={onBack}
      onSaved={onSaved}
    />,
  )
  return {
    geo,
    createBaitSite,
    onBack,
    onSaved,
    unmount,
    save: () => screen.getByRole<HTMLButtonElement>('button', { name: ptBR.sites.save }),
    name: () => screen.getByLabelText<HTMLInputElement>(ptBR.sites.nameLabel),
    emit: (next: GeoReading) => act(() => geo.emit(next)),
  }
}

describe('GPS', () => {
  test('watch starts on mount and stops on unmount', () => {
    const t = setup()

    expect(t.geo.watch).toHaveBeenCalledOnce()
    expect(t.geo.stop).not.toHaveBeenCalled()

    t.unmount()
    expect(t.geo.stop).toHaveBeenCalled()
    expect(t.geo.activeCount()).toBe(0)
  })

  test('Salvar is disabled until a usable reading, then enabled', () => {
    const t = setup()
    expect(screen.getByText(ptBR.sites.searching)).toBeTruthy()
    expect(t.save().disabled).toBe(true)

    t.emit(reading(0))
    expect(t.save().disabled).toBe(true)
    expect(screen.getByText(ptBR.sites.searching)).toBeTruthy()

    t.emit(reading(30))
    expect(t.save().disabled).toBe(false)
  })

  test('the accuracy shown is the best so far, rounded', () => {
    const t = setup()

    t.emit(reading(8.4))
    expect(screen.getByText(ptBR.sites.accuracy(8))).toBeTruthy()

    t.emit(reading(15))
    expect(screen.getByText(ptBR.sites.accuracy(8))).toBeTruthy()

    t.emit(reading(4.6))
    expect(screen.getByText(ptBR.sites.accuracy(5))).toBeTruthy()
  })

  test("'unavailable' before a reading says so; the first reading clears it; later it changes nothing", () => {
    const t = setup()

    act(() => t.geo.fail('unavailable'))
    expect(screen.getByText(ptBR.sites.noSignal)).toBeTruthy()
    expect(t.save().disabled).toBe(true)

    t.emit(reading(12))
    expect(screen.queryByText(ptBR.sites.noSignal)).toBeNull()
    expect(screen.getByText(ptBR.sites.accuracy(12))).toBeTruthy()

    act(() => t.geo.fail('unavailable'))
    expect(screen.queryByText(ptBR.sites.noSignal)).toBeNull()
    expect(screen.getByText(ptBR.sites.accuracy(12))).toBeTruthy()
    expect(t.save().disabled).toBe(false)
  })

  test("'denied' shows the alert with the way to allow it again", () => {
    const t = setup()

    act(() => t.geo.fail('denied'))

    expect(screen.getByRole('alert').textContent).toBe(ptBR.sites.locationDenied)
    expect(t.save().disabled).toBe(true)
  })

  test("'unsupported' shows its alert", () => {
    const t = setup()

    act(() => t.geo.fail('unsupported'))

    expect(screen.getByRole('alert').textContent).toBe(ptBR.sites.locationUnsupported)
  })
})

describe('Salvar', () => {
  test('sends the best reading and the name exactly as typed; the date link closed gives occurredAt null', async () => {
    const t = setup()
    expect(t.name().value).toBe('Isca 3')
    expect(t.name().required).toBe(true)
    t.emit(reading(8, -27.5, -49.5))
    t.emit(reading(15, -27.6, -49.6))

    fireEvent.change(t.name(), { target: { value: '  Ipê grande ' } })
    fireEvent.click(t.save())

    expect(t.createBaitSite).toHaveBeenCalledExactlyOnceWith({
      projectId: P,
      name: '  Ipê grande ',
      latitude: -27.5,
      longitude: -49.5,
      locationAccuracyM: 8,
      occurredAt: null,
    })
    await waitFor(() => expect(t.onSaved).toHaveBeenCalledOnce())
  })

  test('the date link opened and filled gives the converted instant; max is set', () => {
    const t = setup()
    t.emit(reading(8))

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.changeDate }))
    const input = screen.getByLabelText<HTMLInputElement>(ptBR.sites.dateLabel)
    expect(input.value).toBe('')
    expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    fireEvent.change(input, { target: { value: '2026-01-10T08:15' } })
    fireEvent.click(t.save())

    const expected = toHistoryInstant(new Date(2026, 0, 10, 8, 15).toISOString())
    expect(expected).not.toBeNull()
    expect(t.createBaitSite.mock.calls[0]?.[0].occurredAt).toBe(expected)
  })

  test('the date link opened but left empty, or closed again with "usar agora", gives null', async () => {
    const t = setup()
    t.emit(reading(8))
    t.createBaitSite.mockResolvedValue('notReady')

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.changeDate }))
    fireEvent.click(t.save())
    await screen.findByRole('alert')

    fireEvent.change(screen.getByLabelText(ptBR.sites.dateLabel), { target: { value: '2026-01-10T08:15' } })
    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.useNow }))
    expect(screen.queryByLabelText(ptBR.sites.dateLabel)).toBeNull()
    await waitFor(() => expect(t.save().disabled).toBe(false))
    fireEvent.click(t.save())

    expect(t.createBaitSite.mock.calls.map((call) => call[0].occurredAt)).toEqual([null, null])
  })

  test("'queued' stops the GPS and goes back", async () => {
    const t = setup()
    t.emit(reading(8))

    fireEvent.click(t.save())

    await waitFor(() => expect(t.onSaved).toHaveBeenCalledOnce())
    // Still mounted here (the test renders the screen alone): stopped by the save itself.
    expect(t.geo.stop).toHaveBeenCalled()
    expect(t.geo.activeCount()).toBe(0)
  })

  test('disabled while createBaitSite is in flight: a double tap queues one site', async () => {
    const t = setup()
    t.emit(reading(8))
    let finish: (outcome: SubmitOutcome) => void = () => {}
    t.createBaitSite.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    fireEvent.click(t.save())
    expect(t.save().disabled).toBe(true)
    fireEvent.click(t.save())
    expect(t.createBaitSite).toHaveBeenCalledOnce()

    finish('notReady')
    await waitFor(() => expect(t.save().disabled).toBe(false))
  })

  test("'notReady' shows the alert and stays, with the name and the reading kept", async () => {
    const t = setup()
    t.emit(reading(8))
    t.createBaitSite.mockResolvedValue('notReady')
    fireEvent.change(t.name(), { target: { value: 'Ipê' } })

    fireEvent.click(t.save())

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.sites.saveFailed)
    expect(t.onSaved).not.toHaveBeenCalled()
    expect(t.name().value).toBe('Ipê')
    expect(screen.getByText(ptBR.sites.accuracy(8))).toBeTruthy()
    expect(t.geo.stop).not.toHaveBeenCalled()
    await waitFor(() => expect(t.save().disabled).toBe(false))
  })

  test('a rejected createBaitSite shows the alert and stays', async () => {
    const t = setup()
    t.emit(reading(8))
    t.createBaitSite.mockRejectedValue(new Error('enqueue failed'))

    fireEvent.click(t.save())

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.sites.saveFailed)
    expect(t.onSaved).not.toHaveBeenCalled()
    expect(t.name().value).toBe('Isca 3')
  })
})

test('Voltar calls onBack', () => {
  const t = setup()

  fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))

  expect(t.onBack).toHaveBeenCalledOnce()
})
