import { createId } from '@paralleldrive/cuid2'
import { eq } from 'drizzle-orm'
import { throwIfnull } from 'tests/utils/query'
import type { TestContext } from 'tests/utils/types'

export function testOneToOneType({ db, schema }: TestContext) {
	const b: typeof schema.oneToOneBs.$inferInsert = { id: createId() }
	const a: typeof schema.oneToOneAs.$inferInsert = { id: createId(), bId: b.id }
	const c: typeof schema.oneToOneCs.$inferInsert = { id: createId(), bId: b.id }

	describe('one to one (type)', () => {
		beforeAll(async () => {
			await db.insert(schema.oneToOneBs).values(b)
			await db.insert(schema.oneToOneCs).values(c)
			await db.insert(schema.oneToOneAs).values(a)
		})

		afterAll(async () => {
			await db.delete(schema.oneToOneAs).where(eq(schema.oneToOneAs.id, a.id))
			await db.delete(schema.oneToOneCs).where(eq(schema.oneToOneCs.id, c.id))
			await db.delete(schema.oneToOneBs).where(eq(schema.oneToOneBs.id, b.id))
		})

		test('a.b (holds foreign key - optional)', async () => {
			const result = await db.query.oneToOneAs
				.findFirst({
					where: (oneToOneAs, { eq }) => eq(oneToOneAs.id, a.id),
					with: {
						b: true,
					},
				})
				.then(throwIfnull)

			expectTypeOf(result.b).toBeNullable()
		})

		test('c.b (holds foreign key - required)', async () => {
			const result = await db.query.oneToOneCs
				.findFirst({
					where: (oneToOneCs, { eq }) => eq(oneToOneCs.id, c.id),
					with: {
						b: true,
					},
				})
				.then(throwIfnull)

			expectTypeOf(result.b).not.toBeNullable()
		})

		test('b.{a,c} (being referenced)', async () => {
			const result = await db.query.oneToOneBs
				.findFirst({
					where: (oneToOneBs, { eq }) => eq(oneToOneBs.id, b.id),
					with: {
						a: true,
						c: true,
					},
				})
				.then(throwIfnull)

			expectTypeOf(result.a).toBeNullable()
			expectTypeOf(result.c).toBeNullable()
		})
	})
}
