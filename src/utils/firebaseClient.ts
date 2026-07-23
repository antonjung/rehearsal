import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore/lite'

// Public web config — safe to ship client-side; access is governed by Firestore
// security rules (anonymous create/get on sharedScripts, no listing, no edits).
const firebaseConfig = {
  apiKey: 'AIzaSyDnTk67IAyoi_c13RU5RAJiVHXLMfx8rf0',
  authDomain: 'cueline-90bee.firebaseapp.com',
  projectId: 'cueline-90bee',
  storageBucket: 'cueline-90bee.firebasestorage.app',
  messagingSenderId: '476222687219',
  appId: '1:476222687219:web:940b482ec5d12246ec3486',
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
