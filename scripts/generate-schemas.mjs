import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodeReviewerConfigSchema } from '../src/shared/contracts/config/config.schema.ts'
import { ReviewReportSchema } from '../src/shared/contracts/report/review-report.schema.ts'
import { toDraft202012JsonSchema } from '../src/shared/schema/json-schema.ts'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemas = [
  {
    schema: CodeReviewerConfigSchema,
    title: 'CodeReviewerConfig',
    id: 'https://codereviewer.local/schemas/config.schema.json',
    outputPaths: [
      resolve(workspaceRoot, 'schema/codereviewer-config.schema.json'),
      resolve(workspaceRoot, 'specs/03-contracts/config.schema.json')
    ]
  },
  {
    schema: ReviewReportSchema,
    title: 'ReviewReport',
    id: 'https://codereviewer.local/schemas/review-report.schema.json',
    outputPaths: [
      resolve(workspaceRoot, 'specs/03-contracts/review-report.schema.json')
    ]
  }
]

const checkMode = process.argv.includes('--check')

if (checkMode) {
  let driftFound = false

  for (const schemaDefinition of schemas) {
    const serialized = serializeSchema(schemaDefinition)

    for (const outputPath of schemaDefinition.outputPaths) {
      const current = await readFile(outputPath, 'utf8').catch(() => '')
      if (current !== serialized) {
        console.error(`${pathRelative(outputPath)} is out of date`)
        driftFound = true
      }
    }
  }

  if (driftFound) {
    process.exit(1)
  }
} else {
  for (const schemaDefinition of schemas) {
    const serialized = serializeSchema(schemaDefinition)

    for (const outputPath of schemaDefinition.outputPaths) {
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, serialized)
    }
  }
}

function serializeSchema(schemaDefinition) {
  const schema = toDraft202012JsonSchema(
    schemaDefinition.schema,
    schemaDefinition.title,
    schemaDefinition.id
  )

  return `${JSON.stringify(schema, null, 2)}\n`
}

function pathRelative(outputPath) {
  return outputPath.slice(workspaceRoot.length + 1).split('\\').join('/')
}
