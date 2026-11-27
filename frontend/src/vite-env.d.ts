/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Leave blank to use this site's origin; optionally override for a separate backend. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
