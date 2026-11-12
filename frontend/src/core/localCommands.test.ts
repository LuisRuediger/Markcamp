import { describe, expect, test, vi } from 'vitest'
import { createLocalCommands } from './localCommands'
import type { LocalSession } from './localSession'
import type { IdGenerator } from './ports'

function setup(submit: LocalSession['submit'] = async () => 'queued') {
  const spy = vi.fn<LocalSession['submit']>(submit)
  let count = 0
  const ids: IdGenerator = {
    newId: () => {
      count += 1
      return `id-${count}`
    },
  }
  return { submit: spy, commands: createLocalCommands({ submit: spy }, ids) }
}

describe('createProject', () => {
  test('submits a createProject item with a new id and returns the outcome', async () => {
    const { submit, commands } = setup()

    await expect(commands.createProject('Farm')).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: 'createProject', projectId: 'id-1', name: 'Farm' })
  })

  test('two calls submit two different ids', async () => {
    const { submit, commands } = setup()

    await commands.createProject('Farm')
    await commands.createProject('Farm')

    const ids = submit.mock.calls.map(([payload]) => payload.projectId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  test("'notReady' is passed through", async () => {
    const { commands } = setup(async () => 'notReady')

    await expect(commands.createProject('Farm')).resolves.toBe('notReady')
  })

  test('a rejecting submit makes it reject', async () => {
    const failure = new Error('enqueue failed')
    const { commands } = setup(async () => {
      throw failure
    })

    await expect(commands.createProject('Farm')).rejects.toBe(failure)
  })

  test('the name is passed untouched', async () => {
    const { submit, commands } = setup()

    await commands.createProject('  x  ')

    expect(submit.mock.calls[0]?.[0]).toMatchObject({ name: '  x  ' })
  })
})
