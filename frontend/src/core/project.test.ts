import { describe, expect, test } from 'vitest'
import { parseProject, parseProjectList, type Project } from './project'

// Moved from projectsStore.test.ts, where these bodies went through GET /projects: the
// store answered 'unavailable' for each. The parser's part of that is a null here.

const A: Project = { id: 'a', name: 'Sítio', role: 'OWNER', createdAt: '2026-11-07T12:00:00Z' }

describe('parseProjectList', () => {
  test('a valid list gives the projects in the body order', () => {
    const B: Project = { id: 'b', name: 'Chácara', role: 'MEMBER', createdAt: '2026-11-07T12:00:00Z' }

    expect(parseProjectList({ items: [B, A] })).toEqual([B, A])
  })

  const SECRET = 'Apiário do vizinho'
  test.each([
    ['no items array', { projects: [{ ...A, name: SECRET }] }],
    ['items that is not an array', { items: { name: SECRET } }],
    ['an item without createdAt', { items: [{ id: 'a', name: SECRET, role: 'OWNER' }] }],
    ['an item with an unknown role', { items: [{ ...A, name: SECRET, role: 'ADMIN' }] }],
    ['an item with a numeric name', { items: [{ ...A, name: 42 }] }],
  ])('a list body with %s gives null', (_name, body) => {
    expect(parseProjectList(body)).toBeNull()
  })
})

describe('parseProject', () => {
  test('copies only the known fields', () => {
    expect(parseProject({ ...A, extra: 'x' })).toEqual(A)
  })
})
