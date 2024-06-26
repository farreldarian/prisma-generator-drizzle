import { beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import type { TestContext } from 'tests/utils/types'

export type SomeBigInt = bigint

export const OUTPUT_FILE = './prisma/drizzle/field-customizations.ts'

export function testFieldCustomization({ db, schema, provider }: TestContext) {
	let content: string
	beforeAll(async () => {
		expect(fs.existsSync(OUTPUT_FILE)).toBe(true)
		content = await Bun.file(OUTPUT_FILE).text()
	})

	describe('allFields', () => {
		test('should contain import', () => {
			expect(content).toInclude(
				"import type { SomeBigInt } from '~/tests/shared/testFieldCustomization'"
			)
		})

		test('should contain correct field definition', () => {
			expect(content).toInclude(
				"allFields: bigint('allFields', { mode: 'bigint' }).$type<SomeBigInt>().$defaultFn(() => 1n)"
			)
		})
	})
}
