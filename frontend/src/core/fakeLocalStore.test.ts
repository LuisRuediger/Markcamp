import { createFakeLocalStore } from './fakeLocalStore'
import { describeLocalStore } from './localStore.suite'

describeLocalStore('in-memory fake', async () => createFakeLocalStore())
