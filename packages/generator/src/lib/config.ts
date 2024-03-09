import type { Dictionary } from '@prisma/sdk'

export type Config = Dictionary<string | string[] | undefined>

export function isRelationalQueryEnabled(config: Config) {
	const value = config.relationalQuery
	if (value === 'false') return false
	return true
}

export function getModuleResolution(config: Config) {
	if ('moduleResolution' in config) {
		return config.moduleResolution
	}
}
