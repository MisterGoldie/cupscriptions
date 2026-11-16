# Bundled fonts

Syne and Figtree are bundled locally so production builds do not depend on Google
Fonts downloads. Both files are the upright variable fonts from the Google Fonts
repository, with their original SIL Open Font License notices included alongside
them.

- Syne: https://github.com/google/fonts/tree/main/ofl/syne
- Figtree: https://github.com/google/fonts/tree/main/ofl/figtree

`src/app/layout.tsx` loads them through `next/font/local` and retains the existing
`--font-display` and `--font-body` CSS variables.
