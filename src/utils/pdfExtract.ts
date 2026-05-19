import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves ?url to the emitted asset path so the worker loads separately
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerSet = false

function ensureWorker() {
  if (!workerSet) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl as string
    workerSet = true
  }
}

export async function extractPdfText(file: File): Promise<string> {
  ensureWorker()
  const arrayBuffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pageTexts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()

    // Each TextItem has str, transform ([sx,sy,hx,hy,x,y]), hasEOL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (content.items as any[]).filter(
      (it) => typeof it.str === 'string' && it.str.trim() !== '',
    )

    if (items.length === 0) continue

    // Sort top-to-bottom (PDF y increases upward), left-to-right
    items.sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]
      if (Math.abs(dy) > 3) return dy
      return a.transform[4] - b.transform[4]
    })

    // Group into visual lines (items within 4px of same baseline)
    const lines: string[] = []
    let currentGroup: typeof items = []
    let currentY: number | null = null

    for (const item of items) {
      const y = item.transform[5] as number
      if (currentY === null || Math.abs(y - currentY) <= 4) {
        currentGroup.push(item)
        if (currentY === null) currentY = y
      } else {
        lines.push(currentGroup.map((i) => i.str).join('').trim())
        currentGroup = [item]
        currentY = y
      }
    }
    if (currentGroup.length > 0) {
      lines.push(currentGroup.map((i) => i.str).join('').trim())
    }

    pageTexts.push(lines.filter((l) => l.length > 0).join('\n'))
  }

  return pageTexts.join('\n')
}
