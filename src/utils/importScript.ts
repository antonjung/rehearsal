import { extractPdfText } from './pdfExtract'
import { parseScript } from './scriptParser'
import type { Script } from '../types'

export async function importScriptFromUrl(url: string, nameOverride?: string): Promise<Script> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`)
  const contentType = res.headers.get('content-type') ?? ''
  const isPdf = contentType.includes('pdf') || url.toLowerCase().includes('.pdf')
  const blob = await res.blob()
  const name = nameOverride ?? (url.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Script')
  let text: string
  if (isPdf) {
    const file = new File([blob], 'script.pdf', { type: 'application/pdf' })
    text = await extractPdfText(file)
  } else {
    text = await blob.text()
  }
  return parseScript(text, name)
}
