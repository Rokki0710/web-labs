import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'
if (!existsSync(python)) {
  console.error('Создайте .venv и установите requirements.txt — см. README.')
  process.exit(1)
}
const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
