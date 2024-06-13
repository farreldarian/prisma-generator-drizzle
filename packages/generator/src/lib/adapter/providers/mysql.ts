import { camelCase, kebabCase } from 'lodash'
import { getDbName } from '~/lib/prisma-helpers/getDbName'
import { namedImport } from '~/lib/syntaxes/imports'
import { createModule } from '~/lib/syntaxes/module'
import { getDateMode } from '~/shared/date-mode'
import { createAdapter } from '../adapter'
import { createField, hasDefault, isDefaultFunc } from '../fields/createField'
import type { BigIntMode } from '../fields/directives/custom'

const coreModule = 'drizzle-orm/mysql-core'

const customBytesModule = createModule({
	name: 'custom-bytes',
	declarations: [
		{
			imports: [namedImport(['customType'], coreModule)],
			code: `export const customBytes = customType<{ data: Buffer }>({
	dataType() {
		return 'LONGBLOB';
	},
	fromDriver(value: unknown) {
		if (Buffer.isBuffer(value)) return value
		throw new Error('Expected Buffer')
	},
	toDriver(value: Buffer) {
		return value
	}
});`,
		},
	],
})

export const mysqlAdapter = createAdapter({
	name: 'mysql',
	getDeclarationFunc: {
		enum(_, values) {
			return {
				imports: [namedImport(['mysqlEnum'], coreModule)],
				func: `(fieldName: string) => mysqlEnum(fieldName, [${values
					.map((v) => `'${v}'`)
					.join(', ')}])`,
			}
		},
		table(name, fields) {
			return {
				imports: [namedImport(['mysqlTable'], coreModule)],
				func: `mysqlTable('${name}', { ${fields
					.map(({ field, func }) => `${field.name}: ${func}`)
					.join(', ')} })`,
			}
		},
	},
	fields: {
		enum(field) {
			const func = `${camelCase(field.type)}Enum`
			return createField({
				field,
				imports: [namedImport([func], `./${kebabCase(field.type)}-enum`)],
				func: `${func}('${getDbName(field)}')`,
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql/#bigint
		BigInt(field) {
			return createField({
				field,
				imports: [namedImport(['bigint'], coreModule)],
				func: (opts: { mode?: BigIntMode }) =>
					`bigint('${getDbName(field)}', { mode: '${opts?.mode ?? 'bigint'}' })`,
				onDefault(field) {
					if (
						field.isId &&
						isDefaultFunc(field) &&
						field.default.name === 'autoincrement'
					) {
						return {
							code: '.autoincrement()',
						}
					}
				},
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql/#boolean
		Boolean(field) {
			return createField({
				field,
				imports: [namedImport(['boolean'], coreModule)],
				func: `boolean('${getDbName(field)}')`,
			})
		},
		Bytes(field) {
			return createField({
				field,
				imports: [namedImport(['customBytes'], `./${customBytesModule.name}`)],
				func: `customBytes('${getDbName(field)}')`,
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql#datetime
		DateTime(field) {
			return createField({
				field,
				imports: [namedImport(['datetime'], coreModule)],
				func: `datetime('${getDbName(field)}', { mode: '${getDateMode(field)}', fsp: 3 })`, // biome-ignore format: keep one line
				// https://github.com/drizzle-team/drizzle-orm/issues/921
				onDefault: (field) => {
					if (
						hasDefault(field) &&
						isDefaultFunc(field) &&
						field.default.name === 'now'
					) {
						return {
							imports: [namedImport(['sql'], 'drizzle-orm')],
							code: '.default(sql`CURRENT_TIMESTAMP(3)`)',
						}
					}

					// Drizzle doesn't respect the timezone, different on postgres
					// Might be caused by https://github.com/drizzle-team/drizzle-orm/issues/1442
					if (field.type === 'DateTime') {
						return {
							code: `.$defaultFn(() => new Date('${field.default}'))`,
						}
					}
				},
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql/#decimal
		Decimal(field) {
			return createField({
				field,
				imports: [namedImport(['decimal'], coreModule)],
				func: `decimal('${getDbName(field)}', { precision: 65, scale: 30 })`,
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql/#float
		Float(field) {
			return createField({
				field,
				imports: [namedImport(['float'], coreModule)],
				func: `float('${getDbName(field)}')`,
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql#integer
		Int(field) {
			return createField({
				field,
				imports: [namedImport(['int'], coreModule)],
				func: `int('${getDbName(field)}')`,
				onDefault(field) {
					if (
						field.isId &&
						isDefaultFunc(field) &&
						field.default.name === 'autoincrement'
					) {
						return {
							code: '.autoincrement()',
						}
					}
				},
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql#json
		Json(field) {
			return createField({
				field,
				imports: [namedImport(['json'], coreModule)],
				func: `json('${getDbName(field)}')`,
				onDefault: (field) => ({
					code: `.$defaultFn(() => (${field.default}))`,
				}),
			})
		},
		// https://orm.drizzle.team/docs/column-types/mysql/#text
		String(field) {
			return createField({
				field,
				imports: [namedImport(['text'], coreModule)],
				func: `text('${getDbName(field)}')`,
			})
		},
	},
	extraModules: [customBytesModule],
})
