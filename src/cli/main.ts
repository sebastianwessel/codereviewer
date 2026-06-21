#!/usr/bin/env node
import { runCli } from './index.js'

const result = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  environment: process.env,
  logSink: process.stderr
})

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout)
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr)
  process.stderr.write('\n')
}

process.exitCode = result.exitCode
