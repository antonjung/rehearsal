declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_GOOGLE_TTS_API_KEY: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
