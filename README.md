# Leaf — a PDF reader for Android

A PWA that renders PDFs with PDF.js. Files never leave the device — decoding happens
in a web worker on the phone.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole app — UI, rendering, zoom, search |
| `manifest.json` | Install metadata + the Android share-target declaration |
| `sw.js` | Offline caching, and the handler that catches shared PDFs |
| `icon*.png`, `icon.svg` | Launcher icons |

## Deploying to GitHub Pages

1. New repo, push all files to the root of `main`.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Wait for the green check, then open `https://<user>.github.io/<repo>/` on your phone.
4. Chrome menu → **Add to Home screen**.

Every path in the app is relative, so the repo subfolder in the URL is fine — no
config to change.

## Getting PDFs into it

Two routes, and the second one is the reason this is a PWA and not just a web page:

- **Open button** — the system file picker, works immediately.
- **Android share sheet** — open a PDF anywhere (Files, Drive, Gmail), hit Share,
  pick Leaf. This only appears **after** you've installed it to the home screen,
  and only once the service worker has activated. If Leaf isn't in the share list,
  open the installed app once and try again.

A PWA can't register itself in Android's "Open with" menu — that requires a native
app with an intent filter. Share is the closest equivalent and covers most of it.

## Controls

| Gesture | Result |
| --- | --- |
| Tap the page | Hide/show the bars |
| Double-tap | Toggle 200% / fit-to-width |
| Pinch | Zoom, re-rendered crisp on release |
| Drag the right-edge rail | Scrub through pages |
| Tap the page counter | Jump to a page number |

The circle button opens **Appearance**, which has two independent settings:

- **Page** — Day, Sepia, Night. Changes only how the document is rendered. Night
  inverts the canvas rather than dimming it, so black-on-white PDFs become
  white-on-black.
- **Interface** — Light, Dark, Auto. Changes only the chrome: bars, panels, the
  surround behind the page. Auto follows your system setting and keeps following
  it if you change it while the app is open.

The two never touch each other, so a white document in a dark interface, or an
inverted document in a light interface, are both valid combinations.

Keyboard, if you ever open it on a desktop: arrows/PageUp/PageDown, Home, End,
`+` / `-` / `0`, Esc. Drag-and-drop works there too.

## Notes on the implementation

- **Pinned to PDF.js 4.10.38.** Loaded from cdnjs, falling back to jsDelivr then
  unpkg if one is unreachable. 4.10.38 is past the fix for CVE-2024-4367 (a
  malformed font could run arbitrary JS), and the app additionally passes
  `isEvalSupported: false`. If you bump to 5.x or 6.x, note that `page.render()`
  changed its parameters — the `canvasContext` call here is a 4.x API.
- **Only nearby pages hold a canvas.** Pages outside the viewport ±1 get their
  canvas dimensions zeroed and detached, which is what actually frees the memory.
  Without this, a 300-page PDF kills the tab.
- **Canvas size is budgeted** to ~12M pixels. Past that, Android Chrome tends to
  hand back a blank canvas instead of throwing, so the app steps the pixel ratio
  down rather than asking for something that won't paint.
- **Search reads text, it doesn't highlight it.** `getTextContent()` per page,
  cached, jumping to pages that contain the term. Real in-page highlighting needs
  a positioned text layer over each canvas — a reasonable next addition.

- **Two disjoint sets of CSS variables.** Interface tokens (`--housing`, `--ink`,
  `--rule`, `--field`, `--well`…) live under `body[data-ui]`. Page tokens
  (`--paper`, `--page-filter`) live under `body[data-page]`. Nothing is declared
  in both places, which is what keeps the two settings from leaking into each
  other. If you add a token, put it on one side or the other.

## Things deliberately left out

- No reading-position or appearance memory — both themes reset on launch. Add it
  with `localStorage`, storing `{page, zoom, pageTheme, uiPref}` keyed on a hash
  of the file. Note that `uiPref` should store `'auto'` as-is rather than the
  resolved value, or Auto stops tracking the system.
- No text selection or copy — same missing text layer as above.
- No annotation, form filling, or outline/bookmarks pane. `doc.getOutline()`
  gives you the last one cheaply if you want it.
