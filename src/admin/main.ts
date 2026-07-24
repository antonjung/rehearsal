import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { app } from '../utils/firebaseClient'
import { listAllSharedScripts, deleteSharedScript, uploadScriptToLibrary } from '../utils/shareScript'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'

const auth = getAuth(app)
const provider = new GoogleAuthProvider()

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const signedOutEl = $('signedOut')
const appEl = $('app')
const signInBtn = $<HTMLButtonElement>('signInBtn')
const signInError = $('signInError')
const signOutBtn = $<HTMLButtonElement>('signOutBtn')
const userEmailEl = $('userEmail')
const uidBox = $('uidBox')
const uploadFile = $<HTMLInputElement>('uploadFile')
const uploadOrg = $<HTMLInputElement>('uploadOrg')
const uploadPin = $<HTMLInputElement>('uploadPin')
const uploadBtn = $<HTMLButtonElement>('uploadBtn')
const uploadStatus = $('uploadStatus')
const refreshBtn = $<HTMLButtonElement>('refreshBtn')
const listStatus = $('listStatus')
const libraryTable = $<HTMLTableElement>('libraryTable')
const libraryBody = $<HTMLTableSectionElement>('libraryBody')

signInBtn.addEventListener('click', async () => {
  signInError.textContent = ''
  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    signInError.textContent = err instanceof Error ? err.message : 'Sign-in failed'
  }
})

signOutBtn.addEventListener('click', () => { void signOut(auth) })

onAuthStateChanged(auth, (user: User | null) => {
  if (user) {
    signedOutEl.style.display = 'none'
    appEl.style.display = 'block'
    userEmailEl.textContent = user.email ?? '(no email)'
    uidBox.textContent = user.uid
    void refreshLibrary()
  } else {
    signedOutEl.style.display = 'block'
    appEl.style.display = 'none'
  }
})

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

async function refreshLibrary() {
  listStatus.textContent = 'Loading…'
  libraryTable.style.display = 'none'
  try {
    const entries = await listAllSharedScripts()
    libraryBody.innerHTML = ''
    for (const entry of entries) {
      const tr = document.createElement('tr')

      const nameTd = document.createElement('td')
      nameTd.textContent = entry.name
      tr.appendChild(nameTd)

      const orgTd = document.createElement('td')
      orgTd.textContent = entry.org
      orgTd.className = 'muted'
      tr.appendChild(orgTd)

      const dateTd = document.createElement('td')
      dateTd.textContent = formatDate(entry.createdAt)
      dateTd.className = 'muted'
      tr.appendChild(dateTd)

      const actionTd = document.createElement('td')
      const delBtn = document.createElement('button')
      delBtn.textContent = 'Delete'
      delBtn.addEventListener('click', () => void handleDelete(entry.id, entry.name, delBtn))
      actionTd.appendChild(delBtn)
      tr.appendChild(actionTd)

      libraryBody.appendChild(tr)
    }
    listStatus.textContent = entries.length === 0 ? 'Nothing in the library yet.' : ''
    libraryTable.style.display = entries.length === 0 ? 'none' : 'table'
  } catch (err) {
    listStatus.textContent = ''
    listStatus.innerHTML = `<span class="err">${err instanceof Error ? err.message : 'Failed to load library'}</span>`
  }
}

async function handleDelete(id: string, name: string, btn: HTMLButtonElement) {
  if (!confirm(`Delete "${name}"? This can't be undone.`)) return
  btn.disabled = true
  btn.textContent = '…'
  try {
    await deleteSharedScript(id)
    await refreshLibrary()
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Delete failed — check the Firestore rules allow your UID to delete.')
    btn.disabled = false
    btn.textContent = 'Delete'
  }
}

refreshBtn.addEventListener('click', () => void refreshLibrary())

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
  } catch (err) {
    uploadStatus.innerHTML = `<span class="err">${err instanceof Error ? err.message : 'Upload failed'}</span>`
  } finally {
    uploadBtn.disabled = false
  }
}
