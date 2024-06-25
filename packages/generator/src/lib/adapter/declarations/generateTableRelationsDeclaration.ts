import type { DMMF } from '@prisma/generator-helper'
import { map } from 'fp-ts/lib/Array'
import { pipe } from 'fp-ts/lib/function'
import { camelCase, kebabCase } from 'lodash'
import pluralize from 'pluralize'
import {
	type PrismaRelationField,
	isRelationField,
} from '~/lib/prisma-helpers/field'
import { getDbName } from '~/lib/prisma-helpers/getDbName'
import { getModelVarName } from '~/lib/prisma-helpers/model'
import { namedImport } from '../../syntaxes/imports'
import type { ModelModule } from '../modules/model'

type GenerateTableRelationsInput = {
	fields: PrismaRelationField[]
	modelModule: ModelModule
	datamodel: DMMF.Datamodel
}

export function generateTableRelationsDeclaration(
	input: GenerateTableRelationsInput
) {
	const { tableVar } = input.modelModule
	const _fields = input.fields.map(getRelationField(input))

	const func = `relations(${tableVar.name}, (helpers) => ({ ${_fields
		.map((f) => `${f.name}: ${f.func}`)
		.join(', ')} }))`

	return {
		imports: [
			namedImport(['relations'], 'drizzle-orm'),
			namedImport([tableVar.name], `./${input.modelModule.name}`),
			..._fields.flatMap((field) => field.imports),
		],
		implicit: _fields.flatMap((field) => field.implicit),
		code: `export const ${tableVar.name}Relations = ${func};`,
	}
}

function getRelationField(ctx: GenerateTableRelationsInput) {
	return (field: PrismaRelationField) => {
		const { implicit, opts, referenceModelVarName } = !field.isList
			? getOneToOneOrManyRelation(field, ctx)
			: opposingIsList(field, ctx)
				? getManyToManyRelation(field, ctx)
				: getManyToOneRelation(field)

		const relFunc = field.isList ? 'helpers.many' : 'helpers.one'

		return {
			name: field.name,
			implicit: implicit,
			imports: [
				namedImport(
					[referenceModelVarName],
					`./${kebabCase(referenceModelVarName)}`
				),
			],
			func: `${relFunc}(${referenceModelVarName}${opts ? `, ${opts}` : ''})`,
		}
	}
}

class DetermineRelationshipError extends Error {
	constructor(field: DMMF.Field, message: string) {
		super(`Cannot determine relationship ${field.relationName}, ${message}`)
	}
}

function getManyToManyRelation(
	field: PrismaRelationField,
	ctx: GenerateTableRelationsInput
) {
	const opposingModel = findOpposingRelationModel(field, ctx.datamodel)
	const joinTable = createImplicitJoinTable(ctx, field.relationName, [
		ctx.modelModule.model,
		opposingModel,
	])

	return createRelation({
		referenceModelVarName: getModelVarName(joinTable.varName),
		implicit: [joinTable.model],
	})
}

function createRelation(input: {
	referenceModelVarName: string
	opts?: ReturnType<typeof createRelationOpts>
	implicit?: DMMF.Model[]
}) {
	return {
		referenceModelVarName: input.referenceModelVarName,
		opts: input.opts ?? null,
		implicit: input.implicit ?? [],
	}
}

function holdsForeignKey(args: {
	field: PrismaRelationField
	model: DMMF.Model
}) {
	const { field, model } = args
	return model.fields.some((f) =>
		field.relationFromFields.some((from) => f.name === from)
	)
}

function getOneToOneOrManyRelation(
	field: PrismaRelationField,
	ctx: GenerateTableRelationsInput
) {
	if (hasReference(field)) {
		return createRelation({
			referenceModelVarName: getModelVarName(field.type),
			opts: holdsForeignKey({ field, model: ctx.modelModule.model })
				? createRelationOpts({
						relationName: field.relationName,
						from: {
							modelVarName: getModelVarName(ctx.modelModule.model),
							fieldNames: field.relationFromFields,
						},
						to: {
							modelVarName: getModelVarName(field.type),
							fieldNames: field.relationToFields,
						},
					})
				: undefined,
		})
	}

	// For disambiguating relation

	const opposingModel = findOpposingRelationModel(field, ctx.datamodel)
	const opposingField = findOpposingRelationField(field, opposingModel)

	return createRelation({
		referenceModelVarName: getModelVarName(field.type),
		opts: holdsForeignKey({ field, model: ctx.modelModule.model })
			? createRelationOpts({
					relationName: field.relationName,
					from: {
						modelVarName: getModelVarName(ctx.modelModule.model),
						fieldNames: opposingField.relationToFields,
					},
					to: {
						modelVarName: getModelVarName(field.type),
						fieldNames: opposingField.relationFromFields,
					},
				})
			: undefined,
	})
}

function getManyToOneRelation(field: PrismaRelationField) {
	const opts = createRelationOpts({ relationName: field.relationName })
	return createRelation({
		referenceModelVarName: getModelVarName(field.type),
		opts,
	})
}

/**
 * Construct Drizzle's `relation()` syntax
 * https://orm.drizzle.team/docs/rqb#declaring-relations
 */
function createRelationOpts(input: {
	relationName?: string
	to?: {
		modelVarName: string
		fieldNames: readonly string[]
	}
	from?: {
		modelVarName: string
		fieldNames: readonly string[]
	}
}) {
	const { relationName, from, to } = input

	const entries = Object.entries({
		relationName: relationName ? `'${relationName}'` : null,
		fields: from
			? `[ ${from.fieldNames
					.map((fieldName) => `${from.modelVarName}.${fieldName}`)
					.join(', ')} ]`
			: null,
		references: to
			? `[ ${to.fieldNames
					.map((fieldName) => `${to.modelVarName}.${fieldName}`)
					.join(', ')} ]`
			: null,
	}).flatMap(([key, value]) => (value == null ? [] : `${key}: ${value}`))

	if (entries.length === 0) return
	return `{ ${entries.join(', ')} }`
}

/**
 * @param baseName The `field.relationName` referring to the generated join table
 * @param models Two models having a many-to-many relationship
 */
function createImplicitJoinTable(
	ctx: GenerateTableRelationsInput,
	baseName: string,
	models: [DMMF.Model, DMMF.Model]
) {
	const pair = models.map(getDbName).sort()

	// Custom varName following drizzle's convention
	const name = pipe(pair, map(pluralize), (names) => names.join('To'))
	const varName = camelCase(name)

	const model = {
		name: name,
		dbName: `_${baseName}`,
		fields: [
			{
				name: 'A',
				kind: 'scalar',
				isList: false,
				isRequired: true,
				isUnique: false,
				isId: false,
				isReadOnly: false,
				hasDefaultValue: false,
				type: 'String',
				isGenerated: false,
				isUpdatedAt: false,
			},
			{
				name: camelCase(pair[0]),
				kind: 'object',
				isList: false,
				isRequired: true,
				isUnique: false,
				isId: false,
				isReadOnly: false,
				hasDefaultValue: false,
				type: pair[0],
				// relationName: `${baseName}_A`,
				relationFromFields: ['A'],
				relationToFields: [findModelPrimaryKey(ctx.datamodel, pair[0]).name],
				isGenerated: false,
				isUpdatedAt: false,
			},
			{
				name: 'B',
				kind: 'scalar',
				isList: false,
				isRequired: true,
				isUnique: false,
				isId: false,
				isReadOnly: false,
				hasDefaultValue: false,
				type: 'String',
				isGenerated: false,
				isUpdatedAt: false,
			},
			{
				name: camelCase(pair[1]),
				kind: 'object',
				isList: false,
				isRequired: true,
				isUnique: false,
				isId: false,
				isReadOnly: false,
				hasDefaultValue: false,
				type: pair[1],
				// relationName: `${baseName}_B`,
				relationFromFields: ['B'],
				relationToFields: [findModelPrimaryKey(ctx.datamodel, pair[1]).name],
				isGenerated: false,
				isUpdatedAt: false,
			},
		],
		primaryKey: { name: null, fields: ['A', 'B'] },
		uniqueFields: [],
		uniqueIndexes: [],
		isGenerated: false,
	} satisfies DMMF.Model

	return { varName, baseName, model, pair }
}

function findModelPrimaryKey(datamodel: DMMF.Datamodel, modelName: string) {
	const model = datamodel.models.find((model) => model.name === modelName)
	if (model == null) throw new Error(`Model ${modelName} not found`)
	const pkField = model.fields.find((field) => field.isId)
	if (pkField == null)
		throw new Error(`Primary key not found in model ${modelName}`)
	return pkField
}

function findOpposingRelationModel(
	field: PrismaRelationField,
	datamodel: DMMF.Datamodel
) {
	const opposingModel = datamodel.models.find((m) => m.name === field.type)
	if (opposingModel) return opposingModel
	throw new DetermineRelationshipError(field, `model ${field.type} not found`)
}

function findOpposingRelationField(
	field: PrismaRelationField,
	opposingModel: DMMF.Model
) {
	const opposingField = opposingModel.fields.find(
		(f) => f.relationName === field.relationName && isRelationField(f)
	)
	if (opposingField) return opposingField as PrismaRelationField
	throw new DetermineRelationshipError(
		field,
		`field with relation ${field.relationName} not found`
	)
}

/**
 * Not a derived relation in which the model holds the reference.
 * Can be one-to-one or one-to-many
 */
function hasReference(field: PrismaRelationField) {
	return (
		field.relationFromFields.length > 0 && field.relationToFields.length > 0
	)
}

function opposingIsList(
	field: PrismaRelationField,
	ctx: GenerateTableRelationsInput
) {
	const opposingModel = findOpposingRelationModel(field, ctx.datamodel)
	return findOpposingRelationField(field, opposingModel).isList
}
