#!/usr/bin/env tsx
/**
 * Validate the source-controlled Railway deployment specification.
 *
 * Contacts nothing. Needs no token. Runs in a few milliseconds, and is the first
 * step of both the bootstrap tool and the bootstrap workflow — because every
 * error it catches is one that would otherwise be found part-way through
 * mutating a live project.
 *
 *   tsx scripts/railway/validate_specification.ts
 *   tsx scripts/railway/validate_specification.ts --json
 *
 * Exit codes
 *   0  the specification is valid
 *   1  at least one error
 *   2  the specification could not be read at all
 */
import { redactedJson } from './lib/redact.ts'
import { parseCommonArguments, rejectCredentialArguments } from './lib/report.ts'
import { loadSpecification, validateSpecification } from './lib/spec.ts'

const args = parseCommonArguments(process.argv.slice(2))

if (args.help) {
  process.stdout.write(
    'Validate the ARPI Railway deployment specification.\n\n' +
      'Usage: tsx scripts/railway/validate_specification.ts [--json]\n\n' +
      'Reads deployment/railway/*.json and railway.json. Contacts no service and\n' +
      'requires no credential.\n'
  )
  process.exit(0)
}

try {
  rejectCredentialArguments(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}

if (args.unknown.length > 0) {
  process.stderr.write(`Unknown argument(s): ${args.unknown.join(', ')}\n`)
  process.exit(2)
}

let result
let loaded
try {
  loaded = loadSpecification()
  result = validateSpecification(loaded)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (args.json) {
    process.stdout.write(`${redactedJson({ ok: false, unreadable: true, error: message })}\n`)
  } else {
    process.stderr.write(`\nThe specification could not be read.\n  ${message}\n`)
  }
  process.exit(2)
}

if (args.json) {
  process.stdout.write(
    `${redactedJson({
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      project: loaded.project.project.name,
      environment: loaded.project.project.environment,
      services: Object.values(loaded.project.services).map((service) => service.name),
    })}\n`
  )
  process.exit(result.ok ? 0 : 1)
}

process.stderr.write('\nARPI Railway specification\n')
process.stderr.write(`  project        : ${loaded.project.project.name}\n`)
process.stderr.write(`  environment    : ${loaded.project.project.environment}\n`)
process.stderr.write(
  `  services       : ${Object.values(loaded.project.services)
    .map((service) => service.name)
    .join(', ')}\n`
)
process.stderr.write(`  repository     : ${loaded.project.repository.slug}\n`)
process.stderr.write(`  branch         : ${loaded.project.repository.deploymentBranch}\n\n`)

for (const warning of result.warnings) {
  process.stderr.write(`  [warn] ${warning}\n`)
}
for (const error of result.errors) {
  process.stderr.write(`  [FAIL] ${error}\n`)
}
process.stderr.write('\n')

if (result.ok) {
  process.stdout.write(
    `OK: specification valid${
      result.warnings.length > 0 ? ` with ${String(result.warnings.length)} warning(s)` : ''
    }.\n`
  )
  process.exit(0)
}

process.stdout.write(`FAILED: ${String(result.errors.length)} specification error(s).\n`)
process.exit(1)
