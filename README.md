# Online Diff Viewer

A browser-only diff viewer for comparing text, code, files, and remote text URLs.

## Run

```sh
npm start
```

Open <http://localhost:8000>.

The app is static, but running it through a local server enables the Web Worker and PWA service worker paths that browsers do not allow from `file://`.

## Build

```sh
npm run build
```

The production files are copied to `dist/`, which is the output directory Vercel serves.

## Deploy to Vercel

This repo includes `vercel.json` for static hosting from `dist/`, clean URLs, PWA manifest headers, and service worker cache behavior.

To connect GitHub automatic deployments:

```sh
vercel link
vercel git connect
vercel deploy --prod
```

After the GitHub repo is connected in Vercel, pushes to the production branch deploy automatically.

## Features

- Line-level diff computation in a Web Worker.
- Side-by-side and unified diff views.
- Aligned line numbers, additions, deletions, modifications, and collapsed unchanged sections.
- Summary counts for added, removed, unchanged, and total changed lines.
- Syntax highlighting for JavaScript, Python, HTML, CSS, and JSON with auto detection and manual override.
- Paste, file upload, drag and drop, and URL fetch inputs with metadata.
- Smart, word, and character-level inline highlighting.
- Ignore whitespace, case, blank lines, indentation, and line endings.
- Line wrapping, synchronized scrolling-friendly single scroll surface, change navigation, and keyboard shortcuts:
  - `J`: next change
  - `K`: previous change
  - `G`: first change
  - `E`: last change
- Copy/export as unified patch, HTML, Markdown, and JSON.
- Offline PWA cache plus local session history and named saves.
- Light, dark, system, and high-contrast themes.
