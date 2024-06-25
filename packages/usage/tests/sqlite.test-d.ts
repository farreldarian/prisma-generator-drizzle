import { schema } from 'prisma/sqlite/drizzle/schema'
import { db } from 'src/lib/sqlite'
import type { Db, Schema } from 'src/lib/types'
import { testOneToOneType } from './shared/testOneToOneType'
import type { TestContext } from './utils/types'

const ctx: TestContext = {
	db: db as unknown as Db,
	schema: schema as unknown as Schema,
	provider: 'sqlite',
}

testOneToOneType(ctx)
