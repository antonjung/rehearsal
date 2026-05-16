import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Script, RehearsalSettings } from '../types'

interface AppState {
  scripts: Script[]
  selectedScriptId: string | null
  rehearsalSettings: RehearsalSettings | null
  theme: string

  addScript: (script: Script) => void
  removeScript: (id: string) => void
  selectScript: (id: string | null) => void
  saveRehearsalSettings: (s: RehearsalSettings) => void
  setTheme: (theme: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      scripts: [],
      selectedScriptId: null,
      rehearsalSettings: null,
      theme: 'stage',

      addScript: (script) =>
        set((s) => ({ scripts: [...s.scripts, script] })),

      removeScript: (id) =>
        set((s) => ({
          scripts: s.scripts.filter((sc) => sc.id !== id),
          selectedScriptId: s.selectedScriptId === id ? null : s.selectedScriptId,
          rehearsalSettings: s.rehearsalSettings?.scriptId === id ? null : s.rehearsalSettings,
        })),

      selectScript: (id) => set({ selectedScriptId: id }),

      saveRehearsalSettings: (settings) => set({ rehearsalSettings: settings }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'rehearsal-store',
      partialize: (s) => ({
        scripts: s.scripts,
        selectedScriptId: s.selectedScriptId,
        rehearsalSettings: s.rehearsalSettings,
        theme: s.theme,
      }),
    },
  ),
)
