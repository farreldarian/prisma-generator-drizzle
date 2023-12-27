import { DMMF } from '@prisma/generator-helper'
import { map } from 'fp-ts/lib/Array'
import { pipe } from 'fp-ts/lib/function'
import { camelCase, kebabCase } from 'lodash'
import pluralize from 'pluralize'
import { array } from '~/lib/definitions/types/array'
import { string } from '~/lib/definitions/types/string'
import {
  PrismaRelationField,
  isRelationField,
} from '~/lib/prisma-helpers/field'
import { getDbName } from '~/lib/prisma-helpers/getDbName'
import { getModelVarName } from '~/lib/prisma-helpers/model'
import { Definition, createDef } from '../../definitions/createDef'
import { constDeclaration } from '../../definitions/types/constDeclaration'
import { funcCall } from '../../definitions/types/funcCall'
import { namedImport } from '../../definitions/types/imports'
import { lambda } from '../../definitions/types/lambda'
import { object } from '../../definitions/types/object'
import { useVar } from '../../definitions/types/useVar'

export function generateTableRelationsDeclaration(input: {
  model: DMMF.Model
  tableVarName: string
  fields: PrismaRelationField[]
  datamodel: DMMF.Datamodel
}) {
  const _fields = input.fields.map(
    getRelationField(input.model, input.tableVarName, input.datamodel)
  )

  return createDef({
    imports: [
      namedImport(['relations'], 'drizzle-orm'),
      ..._fields.flatMap((field) => field.imports),
    ],
    additional: _fields.flatMap((field) => field.additional),
    render: constDeclaration(
      `${input.tableVarName}Relations`,
      funcCall('relations', [
        useVar(input.tableVarName),
        lambda(
          useVar('helpers'),
          object(_fields.map((field) => [field.name, field]))
        ),
      ]),
      { export: true }
    ),
  })
}

function getRelationField(
  model: DMMF.Model,
  tableVarName: string,
  datamodel: DMMF.Datamodel
) {
  return function (field: PrismaRelationField) {
    let relationToModel: string
    let additional: DMMF.Model[] = []

    const opts: Partial<
      Record<'relationName' | 'fields' | 'references', Definition>
    > = {}
    if (field.relationName) {
      opts.relationName = string(field.relationName)
    }

    // Check for implicit many-to-many relation
    if (field.isList) {
      const opposingModel = findOpposingRelationModel(field, datamodel)
      const opposingField = findOpposingRelationField(field, opposingModel)

      if (opposingField.isList && !hasReference(opposingField)) {
        const sortedTables = [getDbName(model), getDbName(opposingModel)].sort()
        const joinTableName = `_${sortedTables
          .map((name) => pluralize(name))
          .join('To')}`
        const joinTableVarName = camelCase(
          sortedTables.map((name) => pluralize(name)).join('To')
        )

        relationToModel = joinTableVarName

        if (getDbName(model) === sortedTables[0]) {
          opts.relationName = string(`${field.relationName}_A`)
        } else {
          opts.relationName = string(`${field.relationName}_B`)
        }

        const joinTableModel = {
          name: joinTableName,
          dbName: `_${sortedTables.join('To')}`,
          fields: [
            {
              name: 'A',
              kind: 'scalar',
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: true,
              isReadOnly: false,
              hasDefaultValue: false,
              type: 'String',
              isGenerated: false,
              isUpdatedAt: false,
            },
            {
              name: camelCase(sortedTables[0]),
              kind: 'object',
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: false,
              isReadOnly: false,
              hasDefaultValue: false,
              type: sortedTables[0],
              relationName: `${field.relationName}_A`,
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
              isId: true,
              isReadOnly: false,
              hasDefaultValue: false,
              type: 'String',
              isGenerated: false,
              isUpdatedAt: false,
            },
            {
              name: camelCase(sortedTables[1]),
              kind: 'object',
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: false,
              isReadOnly: false,
              hasDefaultValue: false,
              type: sortedTables[1],
              relationName: `${field.relationName}_B`,
              relationFromFields: ['B'],
              relationToFields: ['id'],
              isGenerated: false,
              isUpdatedAt: false,
            },
          ],
          primaryKey: null,
          uniqueFields: [],
          uniqueIndexes: [],
          isGenerated: false,
        } satisfies DMMF.Model
        additional.push(joinTableModel)
      } else {
        relationToModel = getModelVarName(field.type)
      }
    } else {
      relationToModel = getModelVarName(field.type)
    }

    const relation = (function () {
      if (field.isList) return
      if (hasReference(field)) {
        return { from: field.relationFromFields, to: field.relationToFields }
      }

      const opposingModel = findOpposingRelationModel(field, datamodel)
      const opposingField = findOpposingRelationField(field, opposingModel)
      if (hasReference(opposingField)) {
        return {
          from: opposingField.relationToFields,
          to: opposingField.relationFromFields,
        }
      }

      throw new DetermineRelationshipError(
        field,
        `opposing field ${opposingField.name} does not have a reference`
      )
    })()

    if (relation) {
      opts.fields = pipe(
        relation.from,
        map((f) => useVar(`${tableVarName}.${f}`)),
        array
      )
      opts.references = pipe(
        relation.to,
        map((f) => useVar(`${relationToModel}.${f}`)),
        array
      )
    }

    const func = funcCall(field.isList ? 'helpers.many' : 'helpers.one', [
      useVar(relationToModel),
      object(opts),
    ])

    return createDef({
      name: field.name,
      additional,
      imports: [
        namedImport([relationToModel], `./${kebabCase(relationToModel)}`),
      ],
      render: func.render,
    })
  }
}

class DetermineRelationshipError extends Error {
  constructor(field: DMMF.Field, message: string) {
    super(`Cannot determine relationship ${field.relationName}, ${message}`)
  }
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
 * Not a derived relation in which the model holds the reference
 */
function hasReference(field: PrismaRelationField) {
  return (
    field.relationFromFields.length > 0 && field.relationToFields.length > 0
  )
}
