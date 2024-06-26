import type { DMMF } from '@prisma/generator-helper'
import * as v from 'valibot'

const DIRECTIVE = 'drizzle.custom'

export function getCustomDirective(field: DMMF.Field) {
	const directiveInput = field.documentation
	if (directiveInput == null || !directiveInput.startsWith(DIRECTIVE)) {
		return
	}

	const jsonParsing = safe(() =>
		JSON.parse(directiveInput.replace(DIRECTIVE, ''))
	)
	if (!jsonParsing.ok)
		throw new Error(`Invalid ${DIRECTIVE} JSON shape\n\n${jsonParsing.error}`)

	const schemaParsing = v.safeParse(DirectiveSchema, jsonParsing.value)
	if (!schemaParsing.success)
		throw new InvalidDirectiveShapeError(schemaParsing.issues)

	return schemaParsing.output
}

const ImportSchema = v.object({
	name: v.union([v.array(v.string()), v.string()]),
	module: v.string(),
	type: v.optional(v.boolean()),
})

const DirectiveSchema = v.object({
	imports: v.optional(v.array(ImportSchema)),
	type: v.optional(v.string()),
	default: v.optional(v.string()),
})

class InvalidDirectiveShapeError extends Error {
	constructor(issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]) {
		super(
			`Invalid ${DIRECTIVE} definition:\n\n${JSON.stringify(v.flatten(issues), null, 2)}`
		)
	}
}

/**
 * Executes a function safely and returns the result or any error that occurred.
 *
 * @template T - The type of the value returned by the function.
 * @param {() => T} func - The function to execute safely.
 * @returns {{ ok: true; value: T } | { ok: false; error: Error }} - An object containing either the result of the function or an error.
 */
function safe<T>(
	func: () => T
): { ok: true; value: T } | { ok: false; error: Error } {
	try {
		return { ok: true, value: func() } as const
	} catch (error) {
		return { ok: false, error: error as Error } as const
	}
}
