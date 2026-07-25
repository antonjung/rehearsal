import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { app } from '../utils/firebaseClient'
import { listAllSharedScripts, deleteSharedScript, uploadScriptToLibrary, listVoiceTracks, type SharedLibraryAdminEntry, type VoiceTrackEntry } from '../utils/shareScript'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'

const auth = getAuth(app)
const provider = new GoogleAuthProvider()

// Only these Google accounts (by UID) may use the admin portal at all.
// Deleting is independently enforced server-side via Firestore rules — this
// list only gates whether the page's UI is shown, so keep both in sync.
const ALLOWED_ADMIN_UIDS = ['J3hoP1HvYNT99gyutghMu3kywgv2']

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const signedOutEl = $('signedOut')
const appEl = $('app')
const signInBtn = $<HTMLButtonElement>('signInBtn')
const signInError = $('signInError')
const signOutBtn = $<HTMLButtonElement>('signOutBtn')
const userEmailEl = $('userEmail')
const copyUidBtn = $<HTMLButtonElement>('copyUidBtn')
const orgFilterInput = $<HTMLInputElement>('orgFilter')
const refreshBtn = $<HTMLButtonElement>('refreshBtn')
const listStatus = $('listStatus')
const libraryTable = $<HTMLTableElement>('libraryTable')
const libraryBody = $<HTMLTableSectionElement>('libraryBody')
const versionText = $('versionText')

const openUploadBtn = $<HTMLButtonElement>('openUploadBtn')
const closeUploadBtn = $<HTMLButtonElement>('closeUploadBtn')
const uploadModalOverlay = $('uploadModalOverlay')
const uploadFile = $<HTMLInputElement>('uploadFile')
const uploadOrg = $<HTMLInputElement>('uploadOrg')
const uploadPin = $<HTMLInputElement>('uploadPin')
const uploadBtn = $<HTMLButtonElement>('uploadBtn')
const uploadStatus = $('uploadStatus')

versionText.textContent = __APP_VERSION__

let currentUid: string | null = null
let allEntries: SharedLibraryAdminEntry[] = []
let sortKey: 'name' | 'createdAt' = 'createdAt'
let sortDir: 'asc' | 'desc' = 'desc'
const expandedVoiceIds = new Set<string>()

signInBtn.addEventListener('click', async () => {
  signInError.textContent = ''
  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    signInError.textContent = err instanceof Error ? err.message : 'Sign-in failed'
  }
})

signOutBtn.addEventListener('click', () => { void signOut(auth) })

const CHECK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'

copyUidBtn.addEventListener('click', () => {
  if (!currentUid) return
  navigator.clipboard.writeText(currentUid).then(() => {
    const original = copyUidBtn.innerHTML
    copyUidBtn.innerHTML = CHECK_ICON_SVG
    setTimeout(() => { copyUidBtn.innerHTML = original }, 1200)
  })
})

onAuthStateChanged(auth, (user: User | null) => {
  if (user && ALLOWED_ADMIN_UIDS.includes(user.uid)) {
    currentUid = user.uid
    signedOutEl.style.display = 'none'
    appEl.style.display = 'block'
    userEmailEl.textContent = user.email ?? '(no email)'
    void refreshLibrary()
  } else if (user) {
    // Signed in with Google, but not an allowed admin — sign out immediately.
    signInError.textContent = `Signed in as ${user.email ?? user.uid}, but this account isn't authorized for the admin portal.`
    void signOut(auth)
  } else {
    currentUid = null
    signedOutEl.style.display = 'block'
    appEl.style.display = 'none'
  }
})

function formatDate(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function renderTable() {
  const filter = orgFilterInput.value.trim().toLowerCase()
  const filtered = filter
    ? allEntries.filter((e) => e.org.toLowerCase().includes(filter))
    : allEntries

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
    return (a.createdAt - b.createdAt) * dir
  })

  libraryBody.innerHTML = ''
  for (const entry of sorted) {
    const tr = document.createElement('tr')

    const nameTd = document.createElement('td')
    nameTd.textContent = entry.name
    nameTd.title = entry.name
    tr.appendChild(nameTd)

    const orgTd = document.createElement('td')
    orgTd.textContent = entry.org
    orgTd.title = entry.org
    orgTd.className = 'muted'
    tr.appendChild(orgTd)

    const dateTd = document.createElement('td')
    dateTd.textContent = formatDate(entry.createdAt)
    dateTd.title = new Date(entry.createdAt).toLocaleString()
    dateTd.className = 'muted'
    tr.appendChild(dateTd)

    const actionTd = document.createElement('td')
    actionTd.className = 'action-cell'

    const voicesBtn = document.createElement('button')
    voicesBtn.className = 'voices-btn'
    voicesBtn.textContent = expandedVoiceIds.has(entry.id) ? 'Voices ▾' : 'Voices ▸'
    actionTd.appendChild(voicesBtn)

    const delBtn = document.createElement('button')
    delBtn.textContent = 'Delete'
    delBtn.addEventListener('click', () => void handleDelete(entry.id, entry.org, entry.name, delBtn))
    actionTd.appendChild(delBtn)

    tr.appendChild(actionTd)
    libraryBody.appendChild(tr)

    const detailTr = document.createElement('tr')
    detailTr.className = 'voice-detail-row'
    detailTr.style.display = expandedVoiceIds.has(entry.id) ? 'table-row' : 'none'
    const detailTd = document.createElement('td')
    detailTd.className = 'voice-detail-cell'
    detailTd.colSpan = 4
    detailTr.appendChild(detailTd)
    libraryBody.appendChild(detailTr)

    voicesBtn.addEventListener('click', () => void toggleVoiceTracks(entry, detailTr, detailTd, voicesBtn))
    if (expandedVoiceIds.has(entry.id)) void renderVoiceTracksInto(entry, detailTd)
  }

  document.querySelectorAll<HTMLButtonElement>('.sort-th').forEach((btn) => {
    const key = btn.dataset.sort
    const active = key === sortKey
    btn.textContent = (key === 'name' ? 'Name' : 'Uploaded') + (active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')
  })

  listStatus.textContent = sorted.length === 0 ? 'Nothing matches.' : ''
  libraryTable.style.display = sorted.length === 0 ? 'none' : 'table'
}

async function toggleVoiceTracks(
  entry: SharedLibraryAdminEntry,
  detailTr: HTMLTableRowElement,
  detailTd: HTMLTableCellElement,
  toggleBtn: HTMLButtonElement,
) {
  if (expandedVoiceIds.has(entry.id)) {
    expandedVoiceIds.delete(entry.id)
    detailTr.style.display = 'none'
    toggleBtn.textContent = 'Voices ▸'
    return
  }
  expandedVoiceIds.add(entry.id)
  toggleBtn.textContent = 'Voices ▾'
  detailTr.style.display = 'table-row'
  await renderVoiceTracksInto(entry, detailTd)
}

// Always fetches fresh — never cached — since voice tracks can be uploaded
// from the app at any time and this list should reflect that immediately,
// including via the inline "Refresh" button without collapsing the row.
async function renderVoiceTracksInto(entry: SharedLibraryAdminEntry, cell: HTMLTableCellElement) {
  cell.innerHTML = ''
  const loading = document.createElement('span')
  loading.className = 'muted'
  loading.textContent = 'Loading voice tracks…'
  cell.appendChild(loading)

  let tracks: VoiceTrackEntry[]
  try {
    tracks = await listVoiceTracks(entry.org, entry.name)
  } catch (err) {
    cell.innerHTML = ''
    const errEl = document.createElement('span')
    errEl.className = 'err'
    errEl.textContent = err instanceof Error ? err.message : 'Failed to load voice tracks'
    cell.appendChild(errEl)
    return
  }

  cell.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'voice-detail-header'
  const refreshVoicesBtn = document.createElement('button')
  refreshVoicesBtn.className = 'voices-refresh-btn'
  refreshVoicesBtn.textContent = '↻ Refresh'
  refreshVoicesBtn.addEventListener('click', () => void renderVoiceTracksInto(entry, cell))
  header.appendChild(refreshVoicesBtn)
  cell.appendChild(header)

  if (tracks.length === 0) {
    const span = document.createElement('span')
    span.className = 'muted'
    span.textContent = 'No voice tracks uploaded.'
    cell.appendChild(span)
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'voice-chips'
  for (const t of tracks) {
    const chip = document.createElement('span')
    const complete = t.recordedCount === t.totalLines
    chip.className = 'voice-chip ' + (complete ? 'complete' : t.recordedCount === 0 ? 'empty' : 'partial')
    chip.textContent = `${t.character} ${t.recordedCount}/${t.totalLines}`
    wrap.appendChild(chip)
  }
  cell.appendChild(wrap)
}

document.querySelectorAll<HTMLButtonElement>('.sort-th').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort as 'name' | 'createdAt'
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey = key
      sortDir = key === 'name' ? 'asc' : 'desc'
    }
    renderTable()
  })
})

orgFilterInput.addEventListener('input', () => renderTable())

async function refreshLibrary() {
  listStatus.textContent = 'Loading…'
  libraryTable.style.display = 'none'
  try {
    allEntries = await listAllSharedScripts()
    renderTable()
  } catch (err) {
    listStatus.innerHTML = `<span class="err">${err instanceof Error ? err.message : 'Failed to load library'}</span>`
  }
}

async function handleDelete(id: string, org: string, name: string, btn: HTMLButtonElement) {
  if (!confirm(`Delete "${name}" and any voice tracks uploaded for it? This can't be undone.`)) return
  btn.disabled = true
  btn.textContent = '…'
  try {
    await deleteSharedScript(id, org, name)
    await refreshLibrary()
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Delete failed — check the Firestore rules allow your UID to delete.')
    btn.disabled = false
    btn.textContent = 'Delete'
  }
}

refreshBtn.addEventListener('click', () => void refreshLibrary())

openUploadBtn.addEventListener('click', () => {
  uploadStatus.innerHTML = ''
  uploadModalOverlay.classList.add('open')
})
closeUploadBtn.addEventListener('click', () => uploadModalOverlay.classList.remove('open'))
uploadModalOverlay.addEventListener('click', (e) => {
  if (e.target === uploadModalOverlay) uploadModalOverlay.classList.remove('open')
})

uploadBtn.addEventListener('click', () => void handleUpload())

async function handleUpload() {
  const file = uploadFile.files?.[0]
  const org = uploadOrg.value.trim()
  const pin = uploadPin.value.trim()
  uploadStatus.innerHTML = ''

  if (!file || !org || !pin) {
    uploadStatus.innerHTML = '<span class="err">Choose a file and fill in organisation + PIN.</span>'
    return
  }

  uploadBtn.disabled = true
  uploadStatus.textContent = 'Uploading…'
  try {
    const name = file.name.replace(/\.[^.]+$/, '')
    const text = file.name.toLowerCase().endsWith('.pdf')
      ? await extractPdfText(file)
      : await file.text()
    const script = parseScript(text, name)
    await uploadScriptToLibrary(script, org, pin)
    uploadStatus.innerHTML = `<span class="ok">Uploaded "${name}".</span>`
    uploadFile.value = ''
    await refreshLibrary()
    setTimeout(() => uploadModalOverlay.classList.remove('open'), 900)
  } catch (err) {
    uploadStatus.innerHTML = `<span class="err">${err instanceof Error ? err.message : 'Upload failed'}</span>`
  } finally {
    uploadBtn.disabled = false
  }
}
