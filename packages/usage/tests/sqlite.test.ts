import { schema } from 'prisma/sqlite/drizzle/schema'
import { db } from 'src/lib/sqlite'
import type { Db, Schema } from 'src/lib/types'
import { testDefault } from './shared/testDefault'
import { testDisambiguatingRelationship } from './shared/testDisambiguatingRelationship'
import { testFieldCustomization } from './shared/testFieldCustomization'
import { testFields } from './shared/testFields'
import { testIgnoreDecorator } from './shared/testIgnoreDecorator'
import { testManyToMany } from './shared/testManyToMany'
import { testOneToMany } from './shared/testOneToMany'
import { testOneToOne } from './shared/testOneToOne'
import { testSelfReferring } from './shared/testSelfReferring'
import type { TestContext } from './utils/types'

const ctx: TestContext = {
	db: db as unknown as Db,
	schema: schema as unknown as Schema,
	provider: 'sqlite',
}

testFields(ctx)
testOneToOne(ctx)
testOneToMany(ctx)
testManyToMany(ctx)
testDisambiguatingRelationship(ctx)
testSelfReferring(ctx)
testIgnoreDecorator(ctx)
testDefault(ctx)
testFieldCustomization(ctx)
