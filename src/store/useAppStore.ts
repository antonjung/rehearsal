import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Script, RehearsalSettings, Note } from '../types'

interface AppState {
  scripts: Script[]
  selectedScriptId: string | null
  rehearsalSettings: RehearsalSettings | null
  theme: string
  scriptFontSize: number
  notes: Note[]

  addScript: (script: Script) => void
  removeScript: (id: string) => void
  updateScript: (script: Script) => void
  selectScript: (id: string | null) => void
  saveRehearsalSettings: (s: RehearsalSettings) => void
  setTheme: (theme: string) => void
  setScriptFontSize: (size: number) => void
  addNote: (text: string) => void
  toggleNote: (id: string) => void
  clearDoneNotes: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      scripts: [],
      selectedScriptId: null,
      rehearsalSettings: null,
      theme: 'stage',
      scriptFontSize: 14,
      notes: [],

      addScript: (script) =>
        set((s) => ({ scripts: [...s.scripts, script] })),

      removeScript: (id) =>
        set((s) => ({
          scripts: s.scripts.filter((sc) => sc.id !== id),
          selectedScriptId: s.selectedScriptId === id ? null : s.selectedScriptId,
          rehearsalSettings: s.rehearsalSettings?.scriptId === id ? null : s.rehearsalSettings,
        })),

      updateScript: (script) =>
        set((s) => ({ scripts: s.scripts.map((sc) => sc.id === script.id ? script : sc) })),

      selectScript: (id) => set({ selectedScriptId: id }),

      saveRehearsalSettings: (settings) => set({ rehearsalSettings: settings }),

      setTheme: (theme) => set({ theme }),

      setScriptFontSize: (size) => set({ scriptFontSize: size }),

      addNote: (text) =>
        set((s) => ({
          notes: [...s.notes, { id: crypto.randomUUID(), text, done: false, createdAt: Date.now() }],
        })),

      toggleNote: (id) =>
        set((s) => ({
          notes: s.notes.map((n) => n.id === id ? { ...n, done: !n.done } : n),
        })),

      clearDoneNotes: () =>
        set((s) => ({ notes: s.notes.filter((n) => !n.done) })),
    }),
    {
      name: 'rehearsal-store',
      partialize: (s) => ({
        scripts: s.scripts,
        selectedScriptId: s.selectedScriptId,
        rehearsalSettings: s.rehearsalSettings,
        theme: s.theme,
        scriptFontSize: s.scriptFontSize,
        notes: s.notes,
      }),
    },
  ),
)
