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
| Type a number into search | Offers "Go to p.N" alongside the search |
| List icon, top bar | Open the library |
| Contents icon, top bar | Bookmarks, highlights and the outline |
| Bookmark icon, bottom bar | Bookmark the current page |
| Select text | Colour swatches appear; tap one to highlight |
| (i) icon, top bar | Document info and metadata editing |
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
- **Panels sit above the on-screen keyboard.** Android Chrome defaults to
  `interactive-widget=resizes-visual`: the keyboard shrinks the visual viewport
  but not the layout viewport, so a `position: fixed; bottom:` panel stays pinned
  *behind* the keyboard. The viewport meta asks for `resizes-content`, and a
  `visualViewport` listener measures the gap into `--kb` for anything that
  ignores it. Any new fixed-position element anchored to the bottom needs
  `+ var(--kb)` in its offset.
- **Navigation is instant over long distances, and holds a target.** Any write to
  `scrollTop` cancels an in-flight smooth scroll where it stands, and two things
  routinely write it: the reflow after a mixed-size page is measured, and the
  resize when the on-screen keyboard opens or closes. An animated jump to page
  450 therefore stopped around page 95. Jumps beyond three screens are now
  instant, `scrollToPage` adopts the target page immediately rather than waiting
  for the next render, and `navTarget` keeps reflows re-anchoring on the
  destination instead of wherever scrolling had reached.
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
- **Highlighting spans runs, lines and hyphens.** Each page is folded into one
  normalised string (lowercased, accents stripped, ligatures split, whitespace
  collapsed) alongside a map from every character back to the text item and
  character it came from. Matches are found in the flat string and projected back
  onto the spans, so a phrase split across two spans, across a line break, or
  across a hyphenated break highlights across all the pieces.
- **The folding path is written for speed, not elegance.** ASCII never touches
  Unicode machinery; `String.normalize()` costs roughly 2 us per call and calling
  it per character cost ~5 ms on a dense page, which a whole-document search
  multiplied into seconds. Non-ASCII characters are folded once and memoised. The
  position map is two `Int32Array`s rather than an array of objects — at one
  object per character a cached document was retaining millions of them.
- **Only the folded string is cached document-wide.** The position map is about
  22 KB per page and is held only for pages currently on screen, then discarded
  with the entry.
- **Text layers wait for the scroll to settle.** A few hundred absolutely
  positioned spans per page is the most expensive thing that can happen during a
  fling, and it is invisible work while pages are flying past. The canvas never
  waits; only text and links are deferred, by 150 ms of quiet.
- **One text fetch per page.** `getTextContent()` feeds both the rendered layer
  and the search index, so the match count and the highlight positions cannot
  disagree. This relies on pdf.js creating exactly one div per item with a `str`
  — items without one are marked-content boundaries and produce no div, so
  `textDivs` runs parallel to the filtered item list. If you change the text
  layer setup, that correspondence is the thing to preserve.
- **Restoring is done from the item strings**, not by unpicking the DOM. Marked
  spans are reset with `div.textContent = items[k].str` before each pass, which
  is why repeated searching never compounds or corrupts the text.
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

## Bookmarks and highlights

Both live on the library record, so both need the document to be in the library.
They show on the page rail — bookmarks as dots, highlighted pages as ticks — and
are listed in the Marks & contents pane, where you can jump to one or remove it.

**A highlight is stored as an offset and length into the page's normalised text,
never as pixels.** Geometry changes with every zoom, rotation and re-render;
text offsets do not. This reuses the position map built for search: creating a
highlight maps the DOM selection back to text offsets, and drawing one runs the
same projection in reverse, measuring client rects at render time. That is why a
highlight stays put across zoom and reopening.

Two details that follow from it:

- **Spans carry a `data-item` index.** That is what maps a DOM selection back to
  a text item. Selection offsets are counted by walking text nodes, so they
  remain correct inside the `<mark>` elements search inserts.
- **Highlights draw behind the text layer**, so selection still works over them.
  Multiply blending reads like a real highlighter on paper; on an inverted night
  page it would go muddy, so night mode lightens instead.

Selections spanning two pages are rejected rather than half-stored, and a mark
whose save fails is rolled back rather than left on screen to disappear later.

## Metadata

The (i) pane shows what pdf.js reports — page count, PDF version, dates,
encryption, forms, signatures, XMP presence — and lets you edit Title, Author,
Subject, Keywords, Creator and Producer.

Editing needs a second library. **pdf.js is a reader and cannot write PDFs at
all**, so saving lazy-loads pdf-lib (~520 KB, fetched only when you press Save,
then cached by the service worker). Three things follow from that:

- **Encrypted PDFs are read-only, deliberately.** pdf-lib's `ignoreEncryption`
  does not decrypt — it copies still-encrypted streams into a file with no
  encryption dictionary, and the result does not open in any reader. I verified
  this: the rewritten file fails with `PasswordException` afterwards. Editing is
  refused rather than risking the file. `info.EncryptFilterName` is the signal.
- **The document must be in your library.** Saving needs the original bytes, and
  pdf.js has already detached the buffer it was handed. They come back from the
  IndexedDB copy, so a document opened while storage was unavailable can be
  viewed but not edited.
- **The result is verified before anything is replaced.** The rewritten bytes are
  re-opened with pdf.js and the page count checked. If that fails, nothing is
  written and the original is left alone. A file that no longer opens is far
  worse than a title that did not change.

Saving also downloads the edited file, and re-keys the library entry under its
new content hash, carrying your reading position across.

Two caveats surfaced in the pane itself: rewriting invalidates a digital
signature, and a PDF carrying XMP may keep showing its old title in readers that
prefer XMP over the standard fields.

## Diagnosing extraction

Document info → **Text extraction** checks the current page automatically and
offers a scan across a spread of up to twelve pages. It separates four failures
that all look identical from the outside:

| Report | Meaning | Fix |
| --- | --- | --- |
| No text at all | A scan — pictures of words | Needs OCR; out of scope here |
| Broken character map | Fonts lack a usable `ToUnicode` table, so extraction returns private-use or control code points. Structurally valid text made of the wrong characters | Nothing the reader can do; the PDF needs rebuilding |
| Words are not separated | Phrases can never match, single words still can | — |
| Multi-column layout | Phrase search can match across the gutter | Needs reading-order reconstruction |

It also prints **what search actually sees** for the page, with private-use and
control characters shown as `⟨E041⟩` so garbled text looks garbled rather than
looking blank.

The checks run on **raw** item text, not the normalised search string. That is
deliberate: the normaliser folds control codes to spaces, which hides exactly
the damage being looked for. A PDF with a broken map yields a search index of
almost pure whitespace, and nothing about it looks wrong until you inspect the
raw characters.

A failed search now also explains itself instead of just saying "no matches".

## When search finds nothing

Two different failures look identical from the outside, so the app now
distinguishes them:

- **No text layer.** A scanned PDF is pictures of words. `getTextContent()`
  returns nothing, so nothing can ever match. The app says so explicitly rather
  than reporting "no matches". Fixing it needs OCR, which is out of scope here.
- **Text present, no match.** Ordinary miss.

Appearance → **Text layer → Reveal** draws the extracted text over a dimmed page.
Empty boxes mean nothing was extracted; boxes offset from the print mean the
layer is misaligned. Those are different problems with different fixes.

### A limitation that is not a bug

Text items arrive in content-stream order, not reading order. In a two-column
layout that means the end of a line in column one is followed immediately by the
start of the corresponding line in column two, so a phrase search can match
across the gutter and produce a hit that looks wrong on the page. Every PDF text
extractor has this; fixing it means reconstructing reading order from geometry.

## Things deliberately left out

- No appearance memory — both themes still reset on launch. The library covers
  reading position, but Page/Interface are per-session. Store `{pageTheme, uiPref}`
  in `localStorage`, and keep `uiPref` as the literal `'auto'` rather than the
  resolved value, or Auto stops tracking the system.
- No storage eviction. The library shows what it's using and lets you remove
  entries, but nothing is dropped automatically. If you want a cap, evict by
  oldest `openedAt` when `navigator.storage.estimate()` gets close to quota.
- No annotation or form filling.
- No regular-expression or whole-word search — matching is plain substring over
  the folded text.
- Dehyphenation always joins a hyphen at a line break. A genuine hyphenated
  compound broken across lines becomes one word in the search index.
