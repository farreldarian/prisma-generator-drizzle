import { schema } from 'prisma/mysql/drizzle/schema'
import { db } from 'src/lib/mysql'
import type { Db, Schema } from 'src/lib/types'
import { testIgnoreDecorator } from './shared/testIgnoreDecorator'
import { testManyToMany } from './shared/testManyToMany'
import { testDefault } from './shared/testDefault'
import { testSelfReferring } from './shared/testSelfReferring'
import { testFields } from './shared/testFields'
import type { TestContext } from './utils/types'
import { testOneToMany } from './shared/testOneToMany'
import { testOneToOne } from './shared/testOneToOne'
import { testDisambiguatingRelationship } from './shared/testDisambiguatingRelationship'

const ctx: TestContext = {
	db: db as unknown as Db,
	schema: schema as unknown as Schema,
	provider: 'mysql',
}

testFields(ctx)
testOneToOne(ctx)
testOneToMany(ctx)
testManyToMany(ctx)
testDisambiguatingRelationship(ctx)
testSelfReferring(ctx)
testIgnoreDecorator(ctx)
testDefault(ctx)
