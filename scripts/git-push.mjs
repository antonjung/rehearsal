import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

try {
  execSync('git add -A', { stdio: 'inherit' })
  execSync(`git commit -m "build: v${version}"`, { stdio: 'inherit' })
  execSync('git push', { stdio: 'inherit' })
} catch (e) {
  process.exit(1)
}
