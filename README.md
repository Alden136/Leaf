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

## The library

Documents you open are kept in IndexedDB, along with the page and zoom you left
them at. Opening the app goes straight to the list; tap a document to resume.

Entries are keyed by a **SHA-256 of the file's bytes**, not its name. Open the same
PDF from Drive and then from Downloads and you get one entry, not two, and it
resumes correctly either way. On a non-secure origin `crypto.subtle` is missing,
so it falls back to a sampled FNV hash over the bytes — weaker, but content-addressed
in the same way.

Storage is split across two object stores on purpose: `docs` holds the small
metadata records the list reads on every open, `files` holds the multi-megabyte
blobs it must never touch. Listing 40 documents reads a few kilobytes.

Removing a document takes two taps. There's no undo, so it asks.

### Where the library will not work

`indexedDB.open()` throws in a sandboxed iframe and in some private-browsing
modes. The app handles this — PDFs still open normally — but the library reports
it plainly instead of just looking empty, because an empty list and a blocked
database are indistinguishable otherwise. If you're testing in an embedded
preview rather than a real origin, expect the storage-unavailable notice.

### The detachment trap

Worth knowing if you modify the open path: pdf.js **transfers** the typed array you
hand `getDocument()` to its worker thread, which detaches the underlying
`ArrayBuffer`. Read it afterwards and you get zero bytes. So the file is written to
IndexedDB *before* pdf.js ever sees it. Reorder those two steps and you'll save
empty files with no error anywhere — the buffer just quietly becomes length zero.



| Gesture | Result |
| --- | --- |
| Tap the page | Hide/show the bars |
| Double-tap | Toggle 200% / fit-to-width |
| Pinch | Zoom, re-rendered crisp on release |
| Drag the right-edge rail | Scrub through pages |
| Tap the page counter | Jump to a page number |
| List icon, top bar | Open the library |
| Contents icon, top bar | Open the outline (only shown if the PDF has one) |
| Long-press on text | Select and copy |

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
- **The DOM is virtualised.** Only pages in the render window exist as elements —
  a 900-page document holds about three. Canvases outside the window have their
  dimensions zeroed and are detached, which is what actually frees the memory.
- **Page positions are computed, never measured.** Reading `offsetTop` forces a
  synchronous layout, so doing it once per page inside a scroll handler is what
  makes long documents crawl. Positions come from a prefix-sum table instead, and
  finding the visible page is a binary search over it. If you add anything to the
  scroll path, keep it away from `offsetTop`, `offsetHeight`, `getBoundingClientRect`
  and bare `getComputedStyle` — the insets are cached in `insets` for this reason.
- **Zoom swaps canvases rather than blanking them.** The old canvas stays on
  screen, stretched by CSS, until the sharper render is ready. Dropping it first
  makes every pinch flash empty.
- **The page container is as wide as the widest page.** Centring an overflowing
  box with flex or auto margins leaves its left edge unreachable by scrolling,
  so each page is absolutely positioned within a container sized to fit.
- **Canvas size is budgeted** to ~12M pixels. Past that, Android Chrome tends to
  hand back a blank canvas instead of throwing, so the app steps the pixel ratio
  down rather than asking for something that won't paint.
- **There is a real text layer.** pdf.js `TextLayer` puts transparent, positioned
  DOM text over each canvas, which is what makes selection, copy, search
  highlighting and screen-reader output possible — a canvas alone offers none of
  those. It is a *sibling* of the canvas, not a parent, so the night-mode invert
  filter applies to the canvas only and highlights keep their colour.
- **Highlighting is per text run.** pdf.js emits one span per positioned chunk,
  so a phrase split across two runs still gets the page jump but not the
  highlight. Fixing that properly means building a normalised page string with an
  offset map back into the spans, which is how pdf.js's own find controller does it.
- **Links are restricted to http(s).** A PDF can name any URI scheme it likes,
  including `javascript:`. Internal links resolve through the same destination
  cache the outline uses.
- **The outline resolves page numbers lazily.** A destination is a page *ref*,
  not a number, so each entry needs a `getPageIndex` round trip. Doing those up
  front would stall opening a large table of contents, so entries render
  immediately and their page numbers fill in as they resolve.

- **Two disjoint sets of CSS variables.** Interface tokens (`--housing`, `--ink`,
  `--rule`, `--field`, `--well`…) live under `body[data-ui]`. Page tokens
  (`--paper`, `--page-filter`) live under `body[data-page]`. Nothing is declared
  in both places, which is what keeps the two settings from leaking into each
  other. If you add a token, put it on one side or the other.

## Things deliberately left out

- No appearance memory — both themes still reset on launch. The library covers
  reading position, but Page/Interface are per-session. Store `{pageTheme, uiPref}`
  in `localStorage`, and keep `uiPref` as the literal `'auto'` rather than the
  resolved value, or Auto stops tracking the system.
- No storage eviction. The library shows what it's using and lets you remove
  entries, but nothing is dropped automatically. If you want a cap, evict by
  oldest `openedAt` when `navigator.storage.estimate()` gets close to quota.
- No annotation or form filling.
- No highlight for matches spanning two text runs (see above).
- No search result count per page — the panel counts pages containing the term,
  not individual matches.
