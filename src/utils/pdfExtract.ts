export async function extractPdfText(file: File): Promise<string> {
  // Dynamic imports so pdfjs-dist is never loaded at app startup —
  // its module-level side effects crash the app before React mounts.
  const [pdfjsLib, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    // Vite ?url resolves this to the emitted asset path at build time
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl as string
  }

  const arrayBuffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pageTexts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (content.items as any[]).filter(
      (it) => typeof it.str === 'string' && it.str.length > 0,
    )
    if (items.length === 0) continue

    // Sort top-to-bottom (PDF y-axis increases upward), then left-to-right
    items.sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]
      if (Math.abs(dy) > 3) return dy
      return a.transform[4] - b.transform[4]
    })

    // Group into visual lines (items within 4px of same baseline)
    const lines: string[] = []
    let group: typeof items = []
    let groupY: number | null = null

    for (const item of items) {
      const y = item.transform[5] as number
      if (groupY === null || Math.abs(y - groupY) <= 4) {
        group.push(item)
        if (groupY === null) groupY = y
      } else {
        lines.push(group.map((i) => i.str).join('').trim())
        group = [item]
        groupY = y
      }
    }
    if (group.length > 0) lines.push(group.map((i) => i.str).join('').trim())

    pageTexts.push(lines.filter((l) => l.length > 0).join('\n'))
  }

  return pageTexts.join('\n')
}
