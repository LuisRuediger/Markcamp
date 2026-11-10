import { createFakeLocalAccounts } from './fakeLocalAccounts'
import { describeLocalAccounts } from './localAccounts.suite'

describeLocalAccounts('in-memory fake', async () => createFakeLocalAccounts())
