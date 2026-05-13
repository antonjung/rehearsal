import sharp from 'sharp'
import { readFileSync } from 'fs'

const svg = readFileSync('./public/icon.svg')

await sharp(svg).resize(512, 512).png().toFile('./public/icon-512.png')
await sharp(svg).resize(192, 192).png().toFile('./public/icon-192.png')
await sharp(svg).resize(180, 180).png().toFile('./public/apple-touch-icon.png')

console.log('Icons generated: icon-512.png, icon-192.png, apple-touch-icon.png')
