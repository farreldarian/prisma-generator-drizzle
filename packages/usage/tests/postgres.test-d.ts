import { schema } from 'prisma/drizzle/schema'
import { db } from 'src/lib/postgres'
import { testOneToOneType } from './shared/testOneToOneType'
import type { TestContext } from './utils/types'

const ctx: TestContext = { db, schema, provider: 'postgres' }

testOneToOneType(ctx)
