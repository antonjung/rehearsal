export interface ThemeDef {
  id: string
  name: string
  swatch: string  // representative color for the swatch button
  vars: {
    '--color-stage-bg': string
    '--color-stage-surface': string
    '--color-stage-border': string
    '--color-stage-accent': string
    '--color-stage-accent-light': string
    '--color-stage-gold': string
    '--color-stage-text': string
    '--color-stage-muted': string
  }
}

export const THEMES: ThemeDef[] = [
  {
    id: 'stage',
    name: 'Stage',
    swatch: '#7c3aed',
    vars: {
      '--color-stage-bg': '#0f0e17',
      '--color-stage-surface': '#1a1830',
      '--color-stage-border': '#2d2b4e',
      '--color-stage-accent': '#7c3aed',
      '--color-stage-accent-light': '#a78bfa',
      '--color-stage-gold': '#f59e0b',
      '--color-stage-text': '#e2e0ff',
      '--color-stage-muted': '#6b6994',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    swatch: '#3b82f6',
    vars: {
      '--color-stage-bg': '#080808',
      '--color-stage-surface': '#111111',
      '--color-stage-border': '#222222',
      '--color-stage-accent': '#3b82f6',
      '--color-stage-accent-light': '#60a5fa',
      '--color-stage-gold': '#fbbf24',
      '--color-stage-text': '#f0f0f0',
      '--color-stage-muted': '#555555',
    },
  },
  {
    id: 'day',
    name: 'Day',
    swatch: '#6d28d9',
    vars: {
      '--color-stage-bg': '#f3f4f6',
      '--color-stage-surface': '#ffffff',
      '--color-stage-border': '#d1d5db',
      '--color-stage-accent': '#6d28d9',
      '--color-stage-accent-light': '#7c3aed',
      '--color-stage-gold': '#d97706',
      '--color-stage-text': '#111827',
      '--color-stage-muted': '#6b7280',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    swatch: '#b45309',
    vars: {
      '--color-stage-bg': '#1a1208',
      '--color-stage-surface': '#241a0c',
      '--color-stage-border': '#3d2e14',
      '--color-stage-accent': '#b45309',
      '--color-stage-accent-light': '#f59e0b',
      '--color-stage-gold': '#fbbf24',
      '--color-stage-text': '#fef3c7',
      '--color-stage-muted': '#92764a',
    },
  },
]

export function applyTheme(themeId: string): void {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value)
  }
}
