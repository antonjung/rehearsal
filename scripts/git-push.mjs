import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

try {
  // Commit source to main
  execSync('git add -A', { stdio: 'inherit' })
  execSync(`git commit -m "build: v${version}"`, { stdio: 'inherit' })
  execSync('git push', { stdio: 'inherit' })
} catch (e) {
  process.exit(1)
}

// Deploy dist/ to gh-pages branch (what GitHub Pages serves)
try {
  execSync(
    `npx gh-pages -d dist -m "deploy: v${version}" --dotfiles`,
    { stdio: 'inherit' }
  )
} catch (e) {
  console.error('gh-pages deploy failed:', e.message)
  process.exit(1)
}
