/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/info" />

/** App version from web/package.json. */
declare const __APP_VERSION__: string;
/** Short commit of the build, or "local". */
declare const __APP_BUILD__: string;

declare module 'virtual:changelog' {
  /** The repository's CHANGELOG.md, or an empty string when the file is missing. */
  const text: string;
  export default text;
}

declare module 'virtual:notices' {
  /** The repository's THIRD_PARTY_NOTICES.md, or an empty string when the file is missing. */
  const text: string;
  export default text;
}
