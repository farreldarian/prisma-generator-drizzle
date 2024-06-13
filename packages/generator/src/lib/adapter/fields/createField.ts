import type { DMMF } from '@prisma/generator-helper'
import { getDirective } from '~/lib/directive'
import { type ImportValue, namedImport } from '~/lib/syntaxes/imports'
import type { MakeRequired, ModifyType, Prettify } from '~/lib/types/utils'
import { getCustomDirective } from './directives/custom'

export type DefineImport = {
	module: string
	name: string
}

export interface CreateFieldInput {
	field: DMMF.Field
	imports?: ImportValue[]
	func:
		| string
		| (<T extends Partial<Record<string, unknown>>>(opts: T) => string)
	onDefault?: (
		field: FieldWithDefault
	) => { code: string; imports?: ImportValue[] } | undefined
	onPrimaryKey?: (field: DMMF.Field) => string | undefined
}

export type FieldFunc = ReturnType<typeof createField>

export function createField(input: CreateFieldInput) {
	const { field } = input

	let imports = input.imports ?? []

	const custom = getCustomDirective(field)
	if (custom?.imports) {
		imports = imports.concat(
			custom.imports.map((def) =>
				namedImport(
					typeof def.name === 'string' ? [def.name] : def.name,
					def.module,
					def.type ?? false
				)
			)
		)
	}

	let func = `${typeof input.func === 'string' ? input.func : input.func(custom?.field ?? {})}`

	// .type<...>()
	const customType = getCustomType(field)
	if (custom?.type) {
		func += `.$type<${custom.type}>()`
	} else if (customType) {
		imports = imports.concat(customType.imports)
		func += customType.code
	}

	const customDefault = getCustomDefault(field)
	if (custom?.default) {
		func += `.$defaultFn(${custom.default})`
	} else if (customDefault) {
		imports = imports.concat(customDefault.imports)
		func += customDefault.code
	} else if (field.hasDefaultValue) {
		const _field = field as FieldWithDefault
		const def = input.onDefault?.(_field) ?? onDefault(_field)
		if (def) {
			imports = imports.concat(def.imports ?? [])
			func += def.code
		}
	}

	if (field.isId) func += input.onPrimaryKey?.(field) ?? '.primaryKey()'
	else if (field.isRequired || field.hasDefaultValue || !!customDefault)
		func += '.notNull()'

	return {
		imports,
		field,
		name: field.name,
		func: func,
	}
}

function getCustomType(field: DMMF.Field) {
	const directive = getDirective(field, 'drizzle.type')
	if (directive == null) return

	const splits = directive.split('::')

	if (splits.length !== 2)
		throw new Error(`Invalid type definition: ${field.documentation}`)

	const [module, type] = splits

	return {
		imports: namedImport([type], module, true),
		code: `.$type<${type}>()`,
	}
}

function getCustomDefault(field: DMMF.Field) {
	const directive = getDirective(field, 'drizzle.default')
	if (directive == null) return

	const splits = directive.split('::')

	if (splits.length !== 2)
		throw new Error(`Invalid default definition: ${field.documentation}`)

	const [module, _secondFragment] = splits

	const splits2 = _secondFragment.split('`').map((s) => s.trim())
	if (splits2.length === 1) {
		const [type] = splits2
		return {
			imports: namedImport([type], module),
			code: `.$defaultFn(() => ${type}())`,
		}
	}

	if (splits2.length !== 3)
		throw new Error(`Invalid default definition: ${field.documentation}`)

	const [type, code] = splits2
	return {
		imports: namedImport([type], module),
		code: `.$defaultFn(${code})`,
	}
}

// #region onDefault
export type FieldWithDefault = Prettify<MakeRequired<DMMF.Field, 'default'>>

export function hasDefault(field: DMMF.Field): field is FieldWithDefault {
	return field.hasDefaultValue
}

function isDefaultScalar(
	field: FieldWithDefault
): field is Prettify<
	ModifyType<FieldWithDefault, 'default', DMMF.FieldDefaultScalar>
> {
	return typeof field.default !== 'object'
}

export function isDefaultFunc(
	field: FieldWithDefault
): field is Prettify<
	ModifyType<FieldWithDefault, 'default', DMMF.FieldDefault>
> {
	return typeof field.default === 'object' && !Array.isArray(field.default)
}

function isDefaultScalarList(
	field: FieldWithDefault
): field is Prettify<
	ModifyType<FieldWithDefault, 'default', DMMF.FieldDefaultScalar[]>
> {
	return Array.isArray(field.default)
}

function onDefault(
	field: FieldWithDefault
): { imports?: ImportValue[]; code: string } | undefined {
	if (isDefaultFunc(field)) {
		if (field.default.name === 'dbgenerated') {
			return {
				imports: [namedImport(['sql'], 'drizzle-orm')],
				code: `.default(sql\`${field.default.args[0]}\`)`,
			}
		}

		if (field.type === 'DateTime' && field.default.name === 'now') {
			return { code: '.defaultNow()' }
		}
	}

	if (isDefaultScalar(field)) {
		if (field.type === 'Bytes') {
			return {
				code: `.$defaultFn(() => Buffer.from('${field.default}', 'base64'))`,
			}
		}

		const defaultDef = getDefaultScalarDefinition(field, field.default)

		if (defaultDef == null) return
		return {
			code: `.default(${defaultDef})`,
		}
	}

	if (isDefaultScalarList(field)) {
		if (field.type === 'Bytes') {
			return {
				code: `.$defaultFn(() => [ ${field.default
					.map((value) => `Buffer.from('${value}', 'base64')`)
					.join(', ')} ])`,
			}
		}

		const defaultDefs = field.default.map((value) =>
			getDefaultScalarDefinition(field, value)
		)

		if (defaultDefs.some((val) => val == null)) return
		return {
			code: `.default([${defaultDefs.join(', ')}])`,
		}
	}

	console.warn(
		`Unsupported default value: ${JSON.stringify(field.default)} on field ${
			field.name
		}`
	)
}

function getDefaultScalarDefinition(
	field: FieldWithDefault,
	value: DMMF.FieldDefaultScalar
) {
	if (field.kind === 'enum') {
		return `'${value}'`
	}

	switch (field.type) {
		case 'BigInt':
			return `BigInt(${value})`
		case 'Int':
		case 'Float':
		case 'Boolean':
		case 'Json':
			return `${value}`
		case 'Decimal':
		case 'String':
			return `'${value}'`
		case 'DateTime':
			return `new Date('${value}')`

		default:
			console.warn(
				`Unsupported default value: ${JSON.stringify(value)} on field ${
					field.name
				}`
			)
	}
}
// #endregion
