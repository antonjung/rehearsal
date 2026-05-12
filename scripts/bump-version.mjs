import { readFileSync, writeFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
pkg.version = `${major}.${minor + 1}.${patch}`
writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log(`Version bumped to ${pkg.version}`)
