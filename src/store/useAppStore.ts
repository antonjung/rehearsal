import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Script, RehearsalSettings } from '../types'

interface AppState {
  scripts: Script[]
  selectedScriptId: string | null
  rehearsalSettings: RehearsalSettings | null

  addScript: (script: Script) => void
  removeScript: (id: string) => void
  selectScript: (id: string | null) => void
  saveRehearsalSettings: (s: RehearsalSettings) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      scripts: [],
      selectedScriptId: null,
      rehearsalSettings: null,

      addScript: (script) =>
        set((s) => ({ scripts: [...s.scripts, script] })),

      removeScript: (id) =>
        set((s) => ({
          scripts: s.scripts.filter((sc) => sc.id !== id),
          selectedScriptId: s.selectedScriptId === id ? null : s.selectedScriptId,
          rehearsalSettings: s.rehearsalSettings?.scriptId === id ? null : s.rehearsalSettings,
        })),

      selectScript: (id) => set({ selectedScriptId: id }),

      saveRehearsalSettings: (settings) =>
        set({ rehearsalSettings: settings }),
    }),
    {
      name: 'rehearsal-store',
      partialize: (s) => ({
        scripts: s.scripts,
        selectedScriptId: s.selectedScriptId,
        rehearsalSettings: s.rehearsalSettings,
      }),
    },
  ),
)
