/**
 * Pure Node.js icon generator — no external dependencies.
 * Draws at 4× target resolution then downsamples for natural anti-aliasing.
 */
import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

// ── PNG encoder ──────────────────────────────────────────────────────────────

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1) }
  return (c ^ 0xFFFFFFFF) >>> 0
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, d])))
  return Buffer.concat([len, t, d, crc])
}
function encodePNG(w, h, rgba) {
  const hdr = Buffer.alloc(13)
  hdr.writeUInt32BE(w, 0); hdr.writeUInt32BE(h, 4); hdr[8] = 8; hdr[9] = 6
  const stride = 1 + w * 4
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = y * stride + 1 + x * 4
      raw[di] = rgba[si]; raw[di+1] = rgba[si+1]; raw[di+2] = rgba[si+2]; raw[di+3] = rgba[si+3]
    }
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', hdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function drawIconAt(sz) {
  const buf = new Uint8Array(sz * sz * 4)
  const half = sz / 2

  const set = (x, y, r, g, b, a = 255) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || x >= sz || y < 0 || y >= sz) return
    const i = (y * sz + x) * 4, sa = a / 255
    buf[i]   = (buf[i]   * (1-sa) + r * sa) | 0
    buf[i+1] = (buf[i+1] * (1-sa) + g * sa) | 0
    buf[i+2] = (buf[i+2] * (1-sa) + b * sa) | 0
    buf[i+3] = Math.min(255, buf[i+3] + a)
  }

  const sc = sz / 512  // SVG→pixel scale

  // Background: dark indigo rounded rect
  const rc = 96 * sc
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      let ok = true
      if      (x < rc && y < rc)           { const dx=x-rc,dy=y-rc; ok=dx*dx+dy*dy<=rc*rc }
      else if (x > sz-1-rc && y < rc)      { const dx=x-(sz-1-rc),dy=y-rc; ok=dx*dx+dy*dy<=rc*rc }
      else if (x < rc && y > sz-1-rc)      { const dx=x-rc,dy=y-(sz-1-rc); ok=dx*dx+dy*dy<=rc*rc }
      else if (x > sz-1-rc && y > sz-1-rc) { const dx=x-(sz-1-rc),dy=y-(sz-1-rc); ok=dx*dx+dy*dy<=rc*rc }
      if (ok) set(x, y, 30, 27, 75)
    }
  }

  // Face ellipse — gold left half, violet right half
  const fcx=256*sc, fcy=272*sc, frx=174*sc, fry=190*sc
  for (let y = (fcy-fry-2)|0; y <= (fcy+fry+2)|0; y++) {
    if (y < 0 || y >= sz) continue
    for (let x = (fcx-frx-2)|0; x <= (fcx+frx+2)|0; x++) {
      if (x < 0 || x >= sz) continue
      const dx=(x-fcx)/frx, dy=(y-fcy)/fry
      if (dx*dx+dy*dy <= 1) {
        if (x < half) set(x,y,245,158,11)   // gold #f59e0b
        else          set(x,y,124,58,237)    // violet #7c3aed
      }
    }
  }

  // Centre seam
  for (let y=(84*sc)|0; y<=(460*sc)|0; y++) {
    for (let x=(252*sc)|0; x<=(260*sc)|0; x++) set(x,y,12,11,22)
  }

  // Eyes
  const fillEllipseClipped = (cx,cy,ex,ey,r,g,b,left) => {
    cx*=sc; cy*=sc; ex*=sc; ey*=sc
    for (let y=(cy-ey-1)|0; y<=(cy+ey+1)|0; y++) {
      if (y<0||y>=sz) continue
      for (let x=(cx-ex-1)|0; x<=(cx+ex+1)|0; x++) {
        if (x<0||x>=sz) continue
        if (left&&x>=half) continue
        if (!left&&x<half) continue
        const dx=(x-cx)/ex,dy=(y-cy)/ey
        if (dx*dx+dy*dy<=1) set(x,y,r,g,b)
      }
    }
  }
  fillEllipseClipped(188,224,25,28, 30,27,75,  true)   // left eye, dark
  fillEllipseClipped(324,224,25,28, 221,214,254,false)  // right eye, light #ddd6fe

  // Quadratic bezier thick line
  const arc = (x0,y0,qx,qy,x1,y1,r,g,b,thick,left) => {
    x0*=sc;y0*=sc;qx*=sc;qy*=sc;x1*=sc;y1*=sc;thick*=sc
    const t2=thick*thick
    for (let i=0; i<=500; i++) {
      const t=i/500, mt=1-t
      const px=mt*mt*x0+2*mt*t*qx+t*t*x1
      const py=mt*mt*y0+2*mt*t*qy+t*t*y1
      for (let dy=-thick; dy<=thick; dy++) {
        for (let dx=-thick; dx<=thick; dx++) {
          if (dx*dx+dy*dy>t2) continue
          const nx=px+dx, ny=py+dy
          if (left&&nx>=half) continue
          if (!left&&nx<half) continue
          set(nx,ny,r,g,b)
        }
      }
    }
  }
  // Comedy smile: curves down = smile (SVG y-down)
  arc(176,312, 218,368, 255,312,  30,27,75,   8, true)
  // Tragedy frown
  arc(257,344, 298,290, 340,344,  221,214,254, 8, false)

  return buf
}

function downsample(src, srcSz, dstSz, factor) {
  const dst = new Uint8Array(dstSz * dstSz * 4)
  const n = factor * factor
  for (let y = 0; y < dstSz; y++) {
    for (let x = 0; x < dstSz; x++) {
      let r=0,g=0,b=0,a=0
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y*factor+dy)*srcSz+(x*factor+dx))*4
          r+=src[i]; g+=src[i+1]; b+=src[i+2]; a+=src[i+3]
        }
      }
      const oi = (y*dstSz+x)*4
      dst[oi]=(r/n)|0; dst[oi+1]=(g/n)|0; dst[oi+2]=(b/n)|0; dst[oi+3]=(a/n)|0
    }
  }
  return dst
}

function generate(outSize, path) {
  const FACTOR = 4
  const drawSize = outSize * FACTOR
  const hi = drawIconAt(drawSize)
  const lo = downsample(hi, drawSize, outSize, FACTOR)
  writeFileSync(path, encodePNG(outSize, outSize, lo))
  console.log(`  ${path} (${outSize}×${outSize})`)
}

console.log('Generating icons…')
generate(512, './public/icon-512.png')
generate(192, './public/icon-192.png')
generate(180, './public/apple-touch-icon.png')
console.log('Done.')
