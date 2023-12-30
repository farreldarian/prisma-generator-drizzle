import { DMMF } from '@prisma/generator-helper'
import { map } from 'fp-ts/lib/Array'
import { pipe } from 'fp-ts/lib/function'
import { camelCase, kebabCase } from 'lodash'
import pluralize from 'pluralize'
import {
  PrismaRelationField,
  isRelationField,
} from '~/lib/prisma-helpers/field'
import { getDbName } from '~/lib/prisma-helpers/getDbName'
import { getModelVarName } from '~/lib/prisma-helpers/model'
import { namedImport } from '../../definitions/types/imports'

type GenerateTableRelationsInput = {
  model: DMMF.Model
  tableVarName: string
  fields: PrismaRelationField[]
  datamodel: DMMF.Datamodel
}

export function generateTableRelationsDeclaration(
  input: GenerateTableRelationsInput
) {
  const _fields = input.fields.map(getRelationField(input))

  const func = `relations(${input.tableVarName}, (helpers) => ({ ${_fields
    .map((f) => `${f.name}: ${f.code}`)
    .join(', ')} }))`

  return {
    imports: [
      namedImport(['relations'], 'drizzle-orm'),
      ..._fields.flatMap((field) => field.imports),
    ],
    implicit: _fields.flatMap((field) => field.implicit),
    code: `export const ${input.tableVarName}Relations = ${func};`,
  }
}

function getRelationField(ctx: GenerateTableRelationsInput) {
  return function (field: PrismaRelationField) {
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
      code: `${relFunc}(${referenceModelVarName}${opts ? `, ${opts}` : ''})`,
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
  const joinTable = createImplicitJoinTable(field.relationName, [
    ctx.model,
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

function getOneToOneOrManyRelation(
  field: PrismaRelationField,
  ctx: GenerateTableRelationsInput
) {
  if (hasReference(field)) {
    const opts = createRelationOpts({
      relationName: field.relationName,
      from: {
        modelVarName: getModelVarName(ctx.model),
        fieldNames: field.relationFromFields,
      },
      to: {
        modelVarName: getModelVarName(field.type),
        fieldNames: field.relationToFields,
      },
    })
    return createRelation({
      referenceModelVarName: getModelVarName(field.type),
      opts,
    })
  }

  // For disambiguating relation

  const opposingModel = findOpposingRelationModel(field, ctx.datamodel)
  const opposingField = findOpposingRelationField(field, opposingModel)
  const opts = createRelationOpts({
    relationName: field.relationName,
    from: {
      modelVarName: getModelVarName(ctx.model),
      fieldNames: opposingField.relationToFields,
    },
    to: {
      modelVarName: getModelVarName(field.type),
      fieldNames: opposingField.relationFromFields,
    },
  })

  return createRelation({
    referenceModelVarName: getModelVarName(field.type),
    opts,
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
    fieldNames: string[]
  }
  from?: {
    modelVarName: string
    fieldNames: string[]
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
        relationToFields: ['id'],
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
        relationToFields: ['id'],
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
