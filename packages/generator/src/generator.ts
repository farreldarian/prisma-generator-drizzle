import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
	type DMMF,
	type GeneratorOptions,
	generatorHandler,
} from '@prisma/generator-helper'
import { map, reduce } from 'fp-ts/lib/Array'
import { pipe } from 'fp-ts/lib/function'
import { isEmpty } from 'lodash'
import { GENERATOR_NAME } from './constants'
import { generateEnumDeclaration } from './lib/adapter/declarations/generateEnumDeclaration'
import { generateSchemaDeclaration } from './lib/adapter/declarations/generateSchemaDeclaration'
import { generateTableRelationsDeclaration } from './lib/adapter/declarations/generateTableRelationsDeclaration'
import {
	type ModelModule,
	createModelModule,
} from './lib/adapter/modules/createModelModule'
import { isRelationalQueryEnabled } from './lib/config'
import type { Context } from './lib/context'
import { logger } from './lib/logger'
import { getEnumModuleName } from './lib/prisma-helpers/enums'
import { isRelationField } from './lib/prisma-helpers/field'
import {
	type ImportValue,
	type NamedImport,
	namedImport,
} from './lib/syntaxes/imports'
import { type Module, createModule } from './lib/syntaxes/module'
import { setGeneratorContext } from './shared/generator-context'

const { version } = require('../package.json')

generatorHandler({
	onManifest() {
		return {
			version,
			defaultOutput: './drizzle',
			prettyName: GENERATOR_NAME,
		}
	},
	onGenerate: async (options: GeneratorOptions) => {
		setGeneratorContext(options)
		logger.applyConfig(options)

		logger.log('Generating drizzle schema...')

		if (options.datasources.length === 0)
			throw new Error('No datasource specified')
		if (options.datasources.length > 1)
			throw new Error('Only one datasource is supported')

		const adapter = await getAdapter(options)
		const ctx: Context = {
			adapter,
			config: options.generator.config,
			datamodel: options.dmmf.datamodel,
		}

		const output = options.generator.output?.value
		if (!output) throw new Error('No output path specified')

		fs.existsSync(output) && fs.rmSync(output, { recursive: true })
		if (output.endsWith('.ts')) {
			const splits = output.split('/')
			if (splits.length > 1) {
				fs.mkdirSync(splits.slice(0, -1).join('/'), { recursive: true })
			}
		} else {
			fs.mkdirSync(output, { recursive: true })
		}

		const modules: Module[] = []

		for (const module of adapter.extraModules ?? []) {
			const moduleCreation = logger.createTask()

			if (!output.endsWith('.ts')) {
				writeModule(output, module)
			} else {
				modules.push(module)
			}

			moduleCreation.end(`◟ ${module.name}.ts`)
		}

		for (const prismaEnum of options.dmmf.datamodel.enums) {
			const enumCreation = logger.createTask()

			const enumModule = createModule({
				name: getEnumModuleName(prismaEnum),
				declarations: [generateEnumDeclaration(adapter, prismaEnum)],
			})

			if (!output.endsWith('.ts')) {
				writeModule(output, enumModule)
			} else {
				modules.push(enumModule)
			}

			enumCreation.end(`◟ ${enumModule.name}.ts`)
		}

		const modelModules: ModelModule[] = []
		for (const model of options.dmmf.datamodel.models) {
			const modelCreation = logger.createTask()

			const modelModule = createModelModule({ model, ctx })
			if (!output.endsWith('.ts')) {
				writeModule(output, modelModule)
			} else {
				modules.push(modelModule)
			}
			modelModules.push(modelModule)

			modelCreation.end(`◟ ${modelModule.name}.ts`)
		}

		if (isRelationalQueryEnabled(options.generator.config)) {
			const relationalModules = modelModules.flatMap((modelModule) => {
				const creation = logger.createTask()

				const relationalModule = createRelationalModule({ ctx, modelModule })
				if (relationalModule == null) return []

				if (!output.endsWith('.ts')) {
					writeModule(output, relationalModule)
				} else {
					modules.push(relationalModule)
				}

				creation.end(`◟ ${relationalModule.name}.ts`)
				return relationalModule
			})

			const implicitModelModules = relationalModules
				.flatMap((module) => module.implicit)
				.reduce(deduplicateModels, [] as DMMF.Model[])
				.map((model) => {
					const modelCreation = logger.createTask()

					const modelModule = createModelModule({ model, ctx })
					if (!output.endsWith('.ts')) {
						writeModule(output, modelModule)
					} else {
						modules.push(modelModule)
					}

					modelCreation.end(`◟ ${modelModule.name}.ts`)
					return modelModule
				})
			const implicitRelationalModules = implicitModelModules.flatMap(
				(modelModule) => {
					const creation = logger.createTask()

					const relationalModule = createRelationalModule({ ctx, modelModule })
					if (relationalModule == null) return []

					if (!output.endsWith('.ts')) {
						writeModule(output, relationalModule)
					} else {
						modules.push(relationalModule)
					}

					creation.end(`◟ ${relationalModule.name}.ts`)
					return relationalModule
				}
			)

			if (!output.endsWith('.ts')) {
				const schemaModule = createModule({
					name: 'schema',
					declarations: [
						generateSchemaDeclaration([
							...modelModules,
							...relationalModules,
							...implicitModelModules,
							...implicitRelationalModules,
						]),
					],
				})
				writeModule(output, schemaModule)
			}
		}

		if (output.endsWith('.ts')) {
			const module = createModule({
				name: output.split('/').at(-1)!.replace('.ts', ''),
				declarations: modules.flatMap((module) =>
					module.declarations.map((declaration) => {
						return {
							...declaration,
							imports: declaration.imports.filter(
								(i) => !i.module.startsWith('./')
							),
						}
					})
				),
			})
			writeModule(output.split('/').slice(0, -1).join('/'), module)
		}

		const formatter = options.generator.config.formatter
		if (formatter === 'prettier') {
			execSync(`prettier --write ${output}`, { stdio: 'inherit' })
		}
	},
})

export function reduceImports(imports: ImportValue[]) {
	type Plan = { toReduce: NamedImport[]; skipped: ImportValue[] }

	const plan = pipe(
		imports,
		reduce({ toReduce: [], skipped: [] } as Plan, (plan, command) => {
			if (command.type === 'namedImport') {
				plan.toReduce.push(command)
			} else {
				plan.skipped.push(command)
			}
			return plan
		})
	)

	return [
		...plan.skipped,
		...pipe(
			plan.toReduce,
			reduce(new Map<string, Set<string>>(), (accum, command) => {
				if (command.type !== 'namedImport') return accum

				const imports = new Set(accum.get(command.module))
				for (const name of command.names) {
					imports.add(name)
				}

				return accum.set(command.module, imports)
			}),
			(map) => Array.from(map),
			map(([path, names]) => namedImport(Array.from(names), path))
		),
	]
}

function writeModule(basePath: string, module: Module) {
	const writeLocation = path.join(basePath, `${module.name}.ts`)
	fs.writeFileSync(writeLocation, module.code)
}

/**
 * @dev Importing the adapter dynamically so `getGeneratorContext()` won't
 * be called before initialization (`onGenerate`)
 */
async function getAdapter(options: GeneratorOptions) {
	switch (options.datasources[0].provider) {
		case 'cockroachdb': // CockroahDB should be postgres compatible
		case 'postgres':
		case 'postgresql': {
			const mod = await import('./lib/adapter/providers/postgres')
			return mod.postgresAdapter
		}
		case 'mysql': {
			const mod = await import('./lib/adapter/providers/mysql')
			return mod.mysqlAdapter
		}
		case 'sqlite': {
			const mod = await import('./lib/adapter/providers/sqlite')
			return mod.sqliteAdapter
		}
		default:
			throw new Error(
				`Connector ${options.datasources[0].provider} is not supported`
			)
	}
}

function deduplicateModels(accum: DMMF.Model[], model: DMMF.Model) {
	if (accum.some(({ name }) => name === model.name)) return accum
	return [...accum, model]
}

function createRelationalModule(input: {
	modelModule: ModelModule
	ctx: Context
}) {
	const { model } = input.modelModule

	const relationalFields = model.fields.filter(isRelationField)
	if (isEmpty(relationalFields)) return undefined

	const declaration = generateTableRelationsDeclaration({
		fields: relationalFields,
		modelModule: input.modelModule,
		datamodel: input.ctx.datamodel,
	})
	return createModule({
		name: `${input.modelModule.name}-relations`,
		declarations: [declaration],
		implicit: declaration.implicit,
	})
}
