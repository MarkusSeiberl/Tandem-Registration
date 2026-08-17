# Guest Tablet Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screen of the guest registration app fit a Lenovo Tab 11 in both orientations, so a guest never scrolls the page to reach the next step.

**Architecture:** The page stops being the scroller. `#root` is pinned to the visual viewport's height and every screen becomes a three-band grid — head, body, pinned actions — where only the body may scroll, and only when the on-screen keyboard has taken the room away. The two long screens are then relaid out to fit that band: "Deine Daten" into two columns across the full tablet width, and "Teilnahmebedingungen" into a boarding pass whose perforation runs vertically in landscape, with the data-protection notice moved out of the flow into a sheet.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react (jsdom), Playwright, oxlint. No new runtime dependencies.

## The measured problem

Chromium at the target's CSS-pixel sizes, before any change:

| Screen | Hochkant 800×1280 | Quer 1280×800 |
|---|---|---|
| Willkommen | fits | fits |
| Deine Daten | **+296px** | **+776px** |
| Teilnahmebedingungen | **+360px** | **+242px** |
| … Datenschutz aufgeklappt | **+888px** | **+924px** |

Landscape is the hard case for the form and portrait for the contract, but the cause is one thing in both: every screen is a single 560–900px column centred in a much wider tablet, so half the width sits empty while the content runs off the bottom. Re-measure with the same method after each task rather than trusting these numbers to stay put.

## Global Constraints

- **Target device:** Lenovo Tab 11, Android Chrome — **design to 1280×800 CSS px**. **Both orientations must work:** portrait 800×1280 and landscape 1280×800.
  - Where that number comes from: the Tab M11 (1920×1200 physical) and the Tab P11 / P11 Gen 2 (2000×1200 physical) both report a device pixel ratio of 1.5, giving 1280×800 and 1333×800 CSS px respectively. 1280×800 is the smaller envelope, so building to it covers both; on a P11 the extra 53px of landscape width is slack, not a second layout.
  - **This differs from a 4:3 tablet in both directions and both matter.** Landscape is relatively wider (1.60 vs 1.44), which gives the contract's two-column split more room than it would have had. Portrait is *narrower* — 800px against 820 — which is where the form's two columns are tightest: 800 − 48 padding − 32 gap leaves 360px per column, and the PLZ/Wohnort row has to survive inside that. Verify it at 800px, not at a desktop width.
- **The acceptance criterion:** on every screen, in both orientations, with the keyboard closed, `.screen-body` must not be scrollable (`scrollHeight <= clientHeight + 1`) and `.screen-actions` must lie fully inside the viewport. Task 6 encodes this as a permanent Playwright gate.
- **The one sanctioned exception:** while the on-screen keyboard is open, `.screen-body` may scroll. Gboard takes roughly 45% of an 800px landscape screen; no layout fits 11 fields into what remains. What must *never* happen is the guest losing sight of the action bar — that is what the viewport meta and `--app-h` in Task 1 exist for.
- **No new design tokens.** Only these may be used: `--ink`, `--sky`, `--sky-deep`, `--ember`, `--text`, `--text-h`, `--bg`, `--panel-bg`, `--border`, `--accent`, `--accent-dark`, `--accent-contrast`, `--error`, `--sans`, `--mono`.
- **All German copy is unchanged.** No user-visible string may be added, removed, or reworded — including the field labels, the four `<legend>` texts (`Person`, `Körperdaten`, `Adresse`, `Kontakt`), the validation messages, `Bitte den gesamten Vertrag lesen — nach unten scrollen, um fortzufahren.`, `Datenschutzinformation lesen`, `Datenschutzinformation zuklappen`, and every button label. Where this plan needs a control that did not exist before, it reuses an existing string.
- **Class names the tests depend on must survive:** `.scroll-hint`, `.contract-text`, `.signature-pad` (on a `<canvas>`), `.privacy-check` with an `<input>` inside, `.error`. `tests/e2e/flow.spec.ts` selects all of these directly.
- **The read gate is law.** "Weiter" on the contract screen stays disabled until all three of: the contract text has been scrolled to its end, a signature has been drawn, and the data-protection box is ticked. A contract short enough to need no scrolling counts as read on load.
- **Signature payload is unchanged.** The canvas backing store stays 700×280 so `signature_png` keeps the dimensions the contract PDF stamps.
- **Accessibility floor:** visible keyboard focus on every control, tap targets ≥ 48px (Android's Material minimum, not iOS's 44), the sheet in Task 3 is a real modal (focus moves in, Escape closes, focus returns), `prefers-reduced-motion` respected.
- **Commands** (run from the repo root):
  - Guest unit tests: `npm --prefix web/guest run test`
  - Guest type check: `npm --prefix web/guest exec -- tsc -b --force`
    (the `--` is required: without it npm eats the `-b` and the check silently does nothing)
  - Guest lint: `npm --prefix web/guest run lint`
    (oxlint prints nothing on success — exit code 0 is the only signal)
  - End-to-end: `npm run build:web` then `npx playwright test`
  - Root suite: `npm test`

## Design direction

The club already has a visual identity in this app and the brief is to sharpen it for the tablet, not to replace it. Everything below is built from tokens that already exist.

**Colour.** Unchanged. `--sky-deep → --sky → --bg` stays the Welcome altitude gradient and appears nowhere else. `--ember` keeps its single job: the one thing waiting on the guest (the active step tick, the read-gate hint). `--accent` stays "go". `--error` stays wrong.

**Type.** One correction, for the tablet. `h1` drops 40px → 34px: on an 800px-tall landscape screen a 40px heading plus its margin spends 64px restating the screen the guest is already looking at. The `<legend>` elements drop from 20px/600 to 13px/700 uppercase with `0.08em` letter-spacing — the same eyebrow treatment the manifest app uses for `.panel-title`, which buys back 14px per group and makes the two apps read as one product. Labels stay 18px and inputs stay 22px in a 56px-tall box: those are the tap targets and shrinking them is how a tablet form gets worse.

**Layout.** Three bands, everywhere:

```
┌ .screen ─────────────────────────────────┐
│ .screen-head      h1 + step ticks   auto │
├──────────────────────────────────────────┤
│ .screen-body      the only scroller   1fr│
├──────────────────────────────────────────┤
│ .screen-actions   pinned            auto │
└──────────────────────────────────────────┘
```

**Signature element.** The boarding card already in the app grows into the screen and its perforation starts doing structural work. Today it is a horizontal dashed tear with two punched notches, sitting decoratively between the contract text and the signature. In landscape it turns vertical and becomes the seam between the two columns — the contract you read on one side, the stub you sign on the other, which is how a real boarding pass tears. Same motif, same two notches, now carrying the layout instead of ornamenting it.

**Ideation note — what was rejected.** Splitting "Deine Daten" into three sub-steps would fit trivially and was the obvious answer; it was rejected because it adds two taps and hides from the guest how much is being asked of them. The two-column single screen is the harder layout and the better one, and it is what the club chose.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/guest/index.html` | the viewport meta tells Android Chrome to shrink the layout viewport when the keyboard opens | 1 |
| `web/guest/src/useViewportHeight.ts` | **new** — publishes `--app-h` from `visualViewport` so the pinned actions stay above the on-screen keyboard | 1 |
| `web/guest/src/useViewportHeight.test.ts` | **new** — tests for the above | 1 |
| `web/guest/src/index.css` | the shell primitives, the form grid, the sheet, the boarding pass, the orientation rules | 1–5 |
| `web/guest/src/StepTicks.tsx` | **new** — the progress dots, moved out of `App.tsx` so the screens can render them without importing their own parent | 1 |
| `web/guest/src/App.tsx` | calls the hook; step ticks move into each screen's head | 1 |
| `web/guest/src/Welcome.tsx` | adopts the three-band shell | 1 |
| `web/guest/src/Done.tsx` | adopts the three-band shell | 1 |
| `web/guest/src/Form.tsx` | two-column field layout, actions pinned | 2 |
| `web/guest/src/Form.test.tsx` | grouping and no-duplication guards | 2 |
| `web/guest/src/PrivacySheet.tsx` | **new** — the data-protection notice as a modal sheet | 3 |
| `web/guest/src/Contract.tsx` | opens the sheet; boarding-pass layout; actions pinned | 3, 4, 5 |
| `web/guest/src/Contract.test.tsx` | sheet behaviour, read gate, canvas size | 3, 4, 5 |
| `tests/e2e/guest-fits.spec.ts` | **new** — the permanent no-scroll gate, both orientations | 6 |

---

### Task 1: The app shell that never scrolls

**Files:**
- Create: `web/guest/src/useViewportHeight.ts`
- Create: `web/guest/src/useViewportHeight.test.ts`
- Create: `web/guest/src/StepTicks.tsx`
- Modify: `web/guest/index.html`
- Modify: `web/guest/src/App.tsx`
- Modify: `web/guest/src/Welcome.tsx`
- Modify: `web/guest/src/Done.tsx`
- Modify: `web/guest/src/index.css`

**Interfaces:**
- Produces: `useViewportHeight(): void` — a hook with no arguments and no return value, called once from `App`. It sets `--app-h` on `document.documentElement`.
- Produces: `StepTicks` — `export default function StepTicks({ step }: { step: 0 | 1 }): JSX.Element`, in its own module `web/guest/src/StepTicks.tsx`. Tasks 2 and 4 import it as `import StepTicks from './StepTicks'`. It lives in its own file rather than staying in `App.tsx` precisely because `App` imports `Form` and `Contract`: having them import it back from `App` would make the module graph circular.
- Produces: the CSS contract every later task builds on — a screen is
  `<section className="screen X-screen">` containing exactly three children:
  `<div className="screen-head">`, `<div className="screen-body">`, `<div className="screen-actions">`.
  `.screen-body` is the only element allowed to scroll.

- [ ] **Step 1: Write the failing test for the hook**

Create `web/guest/src/useViewportHeight.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useViewportHeight } from './useViewportHeight'

// jsdom has no visualViewport, so the tests install a controllable stand-in.
function fakeViewport(height: number) {
  const listeners = new Map<string, Set<() => void>>()
  const vv = {
    height,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    },
    emit: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  return vv
}

afterEach(() => {
  document.documentElement.style.removeProperty('--app-h')
  vi.unstubAllGlobals()
})

describe('useViewportHeight', () => {
  it('publishes the visual viewport height on mount', () => {
    fakeViewport(800)
    renderHook(() => useViewportHeight())
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('800px')
  })

  it('follows the viewport shrinking when the keyboard opens', () => {
    const vv = fakeViewport(800)
    renderHook(() => useViewportHeight())

    // Gboard on an 800px landscape screen: the visual viewport shrinks by
    // roughly 45%. On a Chrome too old for `interactive-widget` the layout
    // viewport does not follow, so `svh` alone would leave the action bar
    // behind the keyboard.
    vv.height = 440
    vv.emit('resize')

    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('440px')
  })

  it('stops listening when the app unmounts', () => {
    const vv = fakeViewport(800)
    const { unmount } = renderHook(() => useViewportHeight())
    unmount()
    expect(vv.listenerCount('resize')).toBe(0)
    expect(vv.listenerCount('scroll')).toBe(0)
  })

  it('leaves the CSS fallback in place where there is no visual viewport', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    renderHook(() => useViewportHeight())
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm --prefix web/guest run test -- useViewportHeight`

Expected: FAIL — `Failed to resolve import "./useViewportHeight"`.

- [ ] **Step 3: Write the hook**

Create `web/guest/src/useViewportHeight.ts`:

```ts
import { useEffect } from 'react'

/**
 * Publishes the visual viewport's height as `--app-h`.
 *
 * The app shell is pinned to the window so the page itself never scrolls, and
 * the one thing that must never happen is the guest losing sight of "Weiter"
 * when the keyboard comes up.
 *
 * `interactive-widget=resizes-content` in index.html is the primary fix: it
 * tells Android Chrome to shrink the layout viewport, which makes `100svh`
 * correct on its own. This hook is the belt to that pair of braces — the flag
 * is honoured by Chrome 108+ and ignored by everything older, and a kiosk
 * tablet is exactly the device nobody updates. Reading `visualViewport.height`
 * back works either way.
 *
 * Where there is no visualViewport (jsdom, older engines) this writes nothing
 * and the `100svh` fallback in the CSS stands.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const apply = () => {
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
    }
    apply()

    // `scroll` as well as `resize`: the visual viewport is also offset, not only
    // resized, while the keyboard animates in and out.
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web/guest run test -- useViewportHeight`

Expected: PASS — 4 tests.

- [ ] **Step 5: Tell Chrome to shrink the page for the keyboard**

In `web/guest/index.html`, replace the viewport meta:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

with:

```html
    <!--
      `interactive-widget=resizes-content`: when Gboard opens, shrink the layout
      viewport rather than sliding the page up under it. Without this the shell
      keeps its full height and the pinned action bar ends up behind the
      keyboard — see useViewportHeight.ts, which covers the Chrome versions that
      ignore this flag.
    -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content" />
```

- [ ] **Step 6: Write the shell CSS**

In `web/guest/src/index.css`, replace the `#root` rule:

```css
#root {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}
```

with:

```css
/* The window is the app's frame, not a scrolling document: nothing here may
   grow the page. `--app-h` is the visual viewport (see useViewportHeight.ts);
   `100svh` is the fallback for engines that do not report one. */
#root {
  height: var(--app-h, 100svh);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

Then replace the `.screen` rule:

```css
.screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}
```

with:

```css
/* Three bands: what the screen is, what it asks for, and what closes it. Only
   the middle one may ever scroll, and on a tablet with the keyboard down it
   does not — see tests/e2e/guest-fits.spec.ts, which holds this to it. */
.screen {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 16px;
  width: 100%;
  /* Wide enough to use the whole short side of the tablet in landscape (1280,
     or 1333 on a Tab P11) without letting a desktop browser stretch the form
     into two columns nobody can scan. */
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
  padding:
    max(20px, env(safe-area-inset-top))
    max(24px, env(safe-area-inset-right))
    max(20px, env(safe-area-inset-bottom))
    max(24px, env(safe-area-inset-left));
}

.screen-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* The only scroll container in the app. With the keyboard down its content
   fits and it does not scroll; with the keyboard up it is what gives, so the
   head and the actions stay where the guest last saw them. */
.screen-body {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.screen-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
}
```

**Leave the `.actions` rule alone for now.** `Form` and `Contract` still use it and will until Tasks 2 and 4 move them onto `.screen-actions`; deleting it here would leave their buttons unstyled for two commits. Task 4 removes it once the last call site is gone.

Retune the two headings for the shorter landscape screen:

```css
h1 {
  font-family: var(--sans);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-h);
  font-size: 40px;
  margin: 0 0 24px;
  line-height: 120%;
}
```

becomes:

```css
/* 34px, not 40px: on an 800px-tall landscape screen the heading and its margin
   were spending 64px to restate the screen the guest is already looking at.
   The margin goes too — `.screen` sets the gap between the bands. */
h1 {
  font-family: var(--sans);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-h);
  font-size: 34px;
  margin: 0;
  line-height: 120%;
}
```

Finally, move the step ticks' spacing off the top of the page (they now sit inside `.screen-head`):

```css
.step-ticks {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding-top: 20px;
}
```

becomes:

```css
.step-ticks {
  display: flex;
  justify-content: center;
  gap: 10px;
}
```

- [ ] **Step 7: Move the step ticks into their own module**

`StepTicks` is currently declared in `App.tsx` and rendered as a *sibling* of the screen, which puts it outside the shell. It has to move inside each screen's head band — but `App` already imports `Form` and `Contract`, so having those import it back from `App` would make the module graph circular. Give it its own file instead.

Create `web/guest/src/StepTicks.tsx`:

```tsx
/**
 * A guest mid-flow always knows how much of Form -> Contract is left.
 *
 * Rendered by each screen inside its own head band rather than beside the
 * screen: anything outside `.screen` is outside the shell that keeps the page
 * from scrolling. It lives here rather than in App.tsx because App imports the
 * screens that need it, and the reverse import would close a cycle.
 */
export default function StepTicks({ step }: { step: 0 | 1 }) {
  return (
    <div className="step-ticks" aria-hidden="true">
      <span className={`step-tick ${step > 0 ? 'done' : 'active'}`} />
      <span className={`step-tick ${step === 1 ? 'active' : ''}`} />
    </div>
  )
}
```

Then replace the whole of `web/guest/src/App.tsx` with:

```tsx
import { useState } from 'react'
import Welcome from './Welcome'
import Form from './Form'
import type { FormValues } from './Form'
import Contract from './Contract'
import Done from './Done'
import HiddenSettings from './HiddenSettings'
import { submitRegistration } from './api'
import { useViewportHeight } from './useViewportHeight'

type Screen = 'welcome' | 'form' | 'contract' | 'done'

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [formValues, setFormValues] = useState<FormValues | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)

  useViewportHeight()

  function resetToWelcome() {
    setScreen('welcome')
    setFormValues(null)
    setSubmitErrors(null)
    setSubmitting(false)
  }

  async function handleSign(signaturePng: string) {
    if (!formValues) return
    setSubmitting(true)
    setSubmitErrors(null)
    const result = await submitRegistration({
      ...formValues,
      signature_png: signaturePng,
      accepted_terms: true,
      // Contract.tsx will not call onNext without the box ticked, so reaching
      // this line already means the guest acknowledged the notice.
      privacy_ack: true,
    })
    setSubmitting(false)
    if (result.ok) {
      setScreen('done')
    } else {
      setSubmitErrors(result.errors)
    }
  }

  return (
    <div className="app-root">
      {screen === 'welcome' && (
        <Welcome
          onStart={() => setScreen('form')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen === 'form' && (
        <Form
          onNext={(values) => {
            setFormValues(values)
            setScreen('contract')
          }}
          onCancel={resetToWelcome}
        />
      )}
      {screen === 'contract' && (
        <Contract
          onNext={handleSign}
          onCancel={resetToWelcome}
          submitting={submitting}
          errors={submitErrors}
        />
      )}
      {screen === 'done' && <Done onTimeout={resetToWelcome} />}

      {settingsOpen && <HiddenSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
```

- [ ] **Step 8: Convert Welcome to the shell**

Replace the returned JSX in `web/guest/src/Welcome.tsx` (keep the imports, `TAP_COUNT`, `TAP_WINDOW_MS` and `handleLogoTap` exactly as they are):

```tsx
  return (
    <section className="screen welcome-screen">
      <div className="screen-head">
        <button type="button" className="logo-tap" onClick={handleLogoTap} aria-label="HFSC Freistadt">
          <BrandMark size={64} className="welcome-mark" />
          <h1>Willkommen beim HFSC Freistadt</h1>
        </button>
      </div>

      <div className="screen-body">
        <p>Bitte melde dich hier für deinen Tandemsprung an.</p>
      </div>

      <div className="screen-actions">
        <button type="button" className="btn primary big" onClick={onStart}>
          Anmeldung starten
        </button>
      </div>
    </section>
  )
```

In `web/guest/src/index.css`, the Welcome overrides need to follow the new structure. Replace:

```css
.welcome-screen {
  max-width: none;
  justify-content: space-between;
  background: linear-gradient(180deg, var(--sky-deep) 0%, var(--sky) 45%, var(--bg) 100%);
  padding-top: max(56px, env(safe-area-inset-top));
  padding-bottom: max(56px, env(safe-area-inset-bottom));
}
```

with:

```css
.welcome-screen {
  max-width: none;
  background: linear-gradient(180deg, var(--sky-deep) 0%, var(--sky) 45%, var(--bg) 100%);
  padding-top: max(56px, env(safe-area-inset-top));
  padding-bottom: max(56px, env(safe-area-inset-bottom));
}

/* The gradient's own composition: brand at altitude, the invitation in the
   middle air, the CTA down in the thumb-reachable third. The body band centres
   its one line rather than stacking it at the top. */
.welcome-screen .screen-body {
  justify-content: center;
}
```

and replace:

```css
.welcome-screen .btn.big {
  margin-top: auto;
  animation: pulse-go 2.4s ease-in-out infinite;
}
```

with:

```css
/* The "go" light: a soft pulse on the one button that starts the whole flow,
   echoing the dispatch light by a jump-plane's door. `margin-top: auto` is
   gone — the actions band is already pinned to the bottom of the shell. */
.welcome-screen .btn.big {
  animation: pulse-go 2.4s ease-in-out infinite;
}
```

- [ ] **Step 9: Convert Done to the shell**

Replace the whole of `web/guest/src/Done.tsx` with:

```tsx
import { useEffect } from 'react'
import BrandMark from './BrandMark'

export interface DoneProps {
  onTimeout: () => void
  timeoutMs?: number
}

export default function Done({ onTimeout, timeoutMs = 8000 }: DoneProps) {
  useEffect(() => {
    const id = setTimeout(onTimeout, timeoutMs)
    return () => clearTimeout(id)
  }, [onTimeout, timeoutMs])

  return (
    <section className="screen done-screen">
      <div className="screen-head">
        <BrandMark size={72} className="done-mark" />
        <h1>Vielen Dank!</h1>
      </div>

      {/*
        No actions band: this screen has nothing to press. It clears itself
        after `timeoutMs` and the grid's third row collapses to nothing.
      */}
      <div className="screen-body">
        <p>Deine Anmeldung wurde erfolgreich übermittelt.</p>
        <p>Bitte wende dich an das Personal für die weiteren Schritte.</p>
      </div>
    </section>
  )
}
```

The timeout, the props and every German string are unchanged — only the three bands are new.

In `web/guest/src/index.css`, centre this screen's one block of copy the way Welcome's is, by extending the existing selector:

```css
.welcome-screen .screen-body {
  justify-content: center;
}
```

to:

```css
.welcome-screen .screen-body,
.done-screen .screen-body {
  justify-content: center;
}
```

- [ ] **Step 10: Run the guest suite**

Run: `npm --prefix web/guest run test`

Expected: PASS — every test in `useViewportHeight.test.ts`, `Form.test.tsx`, `Contract.test.tsx`.

- [ ] **Step 11: Type check and lint**

Run: `npm --prefix web/guest exec -- tsc -b --force`

Expected: no output, exit code 0.

Run: `npm --prefix web/guest run lint`

Expected: no output, exit code 0.

- [ ] **Step 12: Commit**

```bash
git add web/guest/index.html \
        web/guest/src/useViewportHeight.ts web/guest/src/useViewportHeight.test.ts \
        web/guest/src/StepTicks.tsx web/guest/src/App.tsx \
        web/guest/src/Welcome.tsx web/guest/src/Done.tsx \
        web/guest/src/index.css
git commit -m "feat(guest): pin the app to the window instead of scrolling the page"
```

---

### Task 2: "Deine Daten" in two columns

**Files:**
- Modify: `web/guest/src/Form.tsx`
- Modify: `web/guest/src/Form.test.tsx`
- Modify: `web/guest/src/index.css`

**Interfaces:**
- Consumes: the `.screen` / `.screen-head` / `.screen-body` / `.screen-actions` contract from Task 1, and `StepTicks` (default export) from `./StepTicks`.
- Produces: nothing later tasks depend on.

**What moves where.** The four fieldsets keep their legends and their fields; they are dealt into two columns:

```
┌ PERSON ──────────────┬ ADRESSE ─────────────┐
│ Vorname              │ Straße und Hausnummer│
│ Nachname             │ PLZ      Wohnort     │
│ Geschlecht (w)(m)(d) │                      │
│ Alter                │ KONTAKT              │
│                      │ E-Mail               │
│ KÖRPERDATEN          │ Telefon              │
│ Größe      Gewicht   │                      │
└──────────────────────┴──────────────────────┘
```

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `web/guest/src/Form.test.tsx`:

```tsx
  it('deals the four groups into two columns', () => {
    render(<Form onNext={() => {}} />)

    const columns = document.querySelectorAll('.form-col')
    expect(columns).toHaveLength(2)

    const left = within(columns[0] as HTMLElement)
    const right = within(columns[1] as HTMLElement)

    // The guest reads themselves down the left and where to reach them down
    // the right; a field in the wrong column is a field they hunt for.
    expect(left.getByLabelText('Vorname')).toBeInTheDocument()
    expect(left.getByLabelText('Nachname')).toBeInTheDocument()
    expect(left.getByLabelText('Alter')).toBeInTheDocument()
    expect(left.getByLabelText('Größe (cm)')).toBeInTheDocument()
    expect(left.getByLabelText('Gewicht (kg)')).toBeInTheDocument()
    expect(left.getByRole('radiogroup', { name: 'Geschlecht' })).toBeInTheDocument()

    expect(right.getByLabelText('Straße und Hausnummer')).toBeInTheDocument()
    expect(right.getByLabelText('PLZ')).toBeInTheDocument()
    expect(right.getByLabelText('Wohnort')).toBeInTheDocument()
    expect(right.getByLabelText('E-Mail')).toBeInTheDocument()
    expect(right.getByLabelText('Telefon')).toBeInTheDocument()
  })

  it('asks for each field exactly once', () => {
    render(<Form onNext={() => {}} />)

    // A two-column rewrite is exactly the edit that duplicates a field into
    // both columns, and `within(column)` above cannot see that.
    for (const label of [
      'Vorname', 'Nachname', 'Alter', 'Größe (cm)', 'Gewicht (kg)',
      'Straße und Hausnummer', 'PLZ', 'Wohnort', 'E-Mail', 'Telefon',
    ]) {
      expect(screen.getAllByLabelText(label)).toHaveLength(1)
    }
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('keeps all four group headings', () => {
    render(<Form onNext={() => {}} />)
    for (const legend of ['Person', 'Körperdaten', 'Adresse', 'Kontakt']) {
      expect(screen.getByText(legend)).toBeInTheDocument()
    }
  })

  it('puts both buttons in the pinned action band', () => {
    render(<Form onNext={() => {}} onCancel={() => {}} />)

    const actions = document.querySelector('.screen-actions')
    expect(actions).not.toBeNull()

    const bar = within(actions as HTMLElement)
    expect(bar.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(bar.getByRole('button', { name: 'Weiter' })).toBeInTheDocument()
  })
```

`within` is not imported in this file yet. Change its testing-library import from:

```tsx
import { render, screen } from '@testing-library/react'
```

to:

```tsx
import { render, screen, within } from '@testing-library/react'
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm --prefix web/guest run test -- Form`

Expected: FAIL — `expect(received).toHaveLength(expected)` on `.form-col` (received 0), and `.screen-actions` is null.

- [ ] **Step 3: Restructure the form**

In `web/guest/src/Form.tsx`, add the `StepTicks` import beside the existing ones:

```tsx
import StepTicks from './StepTicks'
```

Then replace the whole `return (…)` block — everything from `<section className="screen form-screen">` to its closing `</section>` — with:

```tsx
  return (
    <section className="screen form-screen">
      <div className="screen-head">
        <h1>Deine Daten</h1>
        <StepTicks step={0} />
      </div>

      {/*
        The form is the body band, and the submit button lives outside it in the
        pinned actions — so `form="guest-form"` on that button is what still ties
        the two together and keeps Enter-to-submit working.
      */}
      <form id="guest-form" className="screen-body" onSubmit={handleSubmit} noValidate>
        <p className="form-intro">Alle Felder sind Pflichtfelder.</p>

        <div className="form-cols">
          <div className="form-col">
            <fieldset className="field-group">
              <legend>Person</legend>

              <div className="field">
                <label htmlFor="first_name">Vorname</label>
                <input id="first_name" type="text" autoComplete="given-name" {...field('firstName')} />
                {showError('firstName') && <p className="error">{showError('firstName')}</p>}
              </div>

              <div className="field">
                <label htmlFor="last_name">Nachname</label>
                <input id="last_name" type="text" autoComplete="family-name" {...field('lastName')} />
                {showError('lastName') && <p className="error">{showError('lastName')}</p>}
              </div>

              {/*
                Radio buttons rather than a <select>: this form is filled in on a tablet
                handed to the guest, where three visible tap targets beat a dropdown.
              */}
              <div className="field">
                <span className="label" id="gender_label">Geschlecht</span>
                <div
                  className="radio-row"
                  role="radiogroup"
                  aria-labelledby="gender_label"
                  aria-required="true"
                  aria-invalid={showError('gender') ? true : undefined}
                >
                  {GENDERS.map((g) => (
                    <label key={g.value} className="radio-option">
                      <input
                        type="radio"
                        name="gender"
                        value={g.value}
                        checked={values.gender === g.value}
                        onChange={() => {
                          setValues((prev) => ({ ...prev, gender: g.value }))
                          setTouched((prev) => ({ ...prev, gender: true }))
                        }}
                      />
                      {g.label}
                    </label>
                  ))}
                </div>
                {showError('gender') && <p className="error">{showError('gender')}</p>}
              </div>

              <div className="field">
                <label htmlFor="age">Alter</label>
                <input id="age" type="number" inputMode="numeric" min={1} max={120} {...field('age')} />
                {showError('age') && <p className="error">{showError('age')}</p>}
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend>Körperdaten</legend>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="height_cm">Größe (cm)</label>
                  <input id="height_cm" type="number" inputMode="numeric" min={100} max={220} {...field('height')} />
                  {showError('height') && <p className="error">{showError('height')}</p>}
                </div>

                <div className="field">
                  <label htmlFor="weight_kg">Gewicht (kg)</label>
                  <input id="weight_kg" type="number" inputMode="numeric" min={20} max={200} {...field('weight')} />
                  {showError('weight') && <p className="error">{showError('weight')}</p>}
                </div>
              </div>
            </fieldset>
          </div>

          <div className="form-col">
            <fieldset className="field-group">
              <legend>Adresse</legend>

              <div className="field">
                <label htmlFor="street">Straße und Hausnummer</label>
                <input id="street" type="text" autoComplete="street-address" {...field('street')} />
                {showError('street') && <p className="error">{showError('street')}</p>}
              </div>

              {/* PLZ is narrow, Wohnort takes the rest — see .field-row in index.css. */}
              <div className="field-row">
                <div className="field field-plz">
                  <label htmlFor="postal_code">PLZ</label>
                  <input id="postal_code" type="text" inputMode="numeric" autoComplete="postal-code" {...field('postalCode')} />
                  {showError('postalCode') && <p className="error">{showError('postalCode')}</p>}
                </div>

                <div className="field field-city">
                  <label htmlFor="city">Wohnort</label>
                  <input id="city" type="text" autoComplete="address-level2" {...field('city')} />
                  {showError('city') && <p className="error">{showError('city')}</p>}
                </div>
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend>Kontakt</legend>

              <div className="field">
                <label htmlFor="email">E-Mail</label>
                <input id="email" type="email" autoComplete="email" {...field('email')} />
                {showError('email') && <p className="error">{showError('email')}</p>}
              </div>

              <div className="field">
                <label htmlFor="phone">Telefon</label>
                <input id="phone" type="tel" autoComplete="tel" {...field('phone')} />
                {showError('phone') && <p className="error">{showError('phone')}</p>}
              </div>
            </fieldset>
          </div>
        </div>
      </form>

      <div className="screen-actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="submit" form="guest-form" className="btn primary" disabled={!isValid}>
          Weiter
        </button>
      </div>
    </section>
  )
```

- [ ] **Step 4: Write the form CSS**

In `web/guest/src/index.css`, replace:

```css
/* Says up front what the error messages can only say afterwards. */
.form-intro {
  width: 100%;
  max-width: 560px;
  margin: -8px 0 20px;
  text-align: left;
  font-size: 16px;
  opacity: 0.75;
}

/* Form screen */
.form-screen form {
  width: 100%;
  max-width: 560px;
  text-align: left;
}
```

with:

```css
/* Says up front what the error messages can only say afterwards. */
.form-intro {
  width: 100%;
  margin: 0 0 16px;
  text-align: left;
  font-size: 16px;
  opacity: 0.75;
}

/* Form screen. The old 560px column left half a tablet empty while the fields
   ran off the bottom; across the full width the same eleven fields fit the
   800px short side of the tablet in either orientation.

   Portrait is the tight case, not landscape: 800 - 48 padding - 32 gap leaves
   360px a column, which is what the PLZ/Wohnort row has to live inside. */
.form-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 32px;
  align-items: start;
  text-align: left;
}

.form-col {
  min-width: 0;
}
```

Tighten the group spacing — the legend becomes an eyebrow, matching the manifest app:

```css
.field-group legend {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-h);
  padding: 0;
  margin-bottom: 12px;
}
```

becomes:

```css
/* Named like the manifest app's panel titles: an eyebrow that says what the
   block is about without competing with the labels under it — and 14px shorter
   per group than the heading it replaces, four times over. */
.field-group legend {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text);
  opacity: 0.7;
  padding: 0;
  margin-bottom: 10px;
}
```

and:

```css
.field-group {
  min-width: 0;
  border: none;
  padding: 0;
  margin: 0 0 28px;
}
```

becomes:

```css
.field-group {
  /* min-width:0 lets the fieldset shrink to its column instead of holding its
     widest child's min-content (a <fieldset> defaults to
     min-inline-size:min-content). */
  min-width: 0;
  border: none;
  padding: 0;
  margin: 0 0 20px;
}

.field-group:last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 5: Run the form tests**

Run: `npm --prefix web/guest run test -- Form`

Expected: PASS — the four new tests plus the seven that were already there.

- [ ] **Step 6: Prove the duplication guard bites**

Temporarily add a second `Telefon` field inside the left column's `Person` fieldset:

```tsx
              <div className="field">
                <label htmlFor="phone_dup">Telefon</label>
                <input id="phone_dup" type="tel" />
              </div>
```

Run: `npm --prefix web/guest run test -- Form`

Expected: FAIL — `asks for each field exactly once`, "expected length 1 but got 2".

**Then remove those five lines again** and re-run to confirm PASS. Do not commit them.

- [ ] **Step 7: Full guest suite, type check, lint**

Run: `npm --prefix web/guest run test`

Expected: PASS.

Run: `npm --prefix web/guest exec -- tsc -b --force`

Expected: no output, exit code 0.

Run: `npm --prefix web/guest run lint`

Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add web/guest/src/Form.tsx web/guest/src/Form.test.tsx web/guest/src/index.css
git commit -m "feat(guest): lay the guest's data out in two columns across the tablet"
```

---

### Task 3: The data-protection notice as a sheet

**Files:**
- Create: `web/guest/src/PrivacySheet.tsx`
- Modify: `web/guest/src/Contract.tsx`
- Modify: `web/guest/src/Contract.test.tsx`
- Modify: `web/guest/src/index.css`

**Interfaces:**
- Produces: `PrivacySheet` — `export default function PrivacySheet(props: { text: string; onClose: () => void }): JSX.Element`. It renders a modal dialog; the caller decides whether it is mounted at all.
- Consumes: nothing from Tasks 1–2 beyond the shared tokens.

**Why.** Opening the notice inline is the single largest overflow in the app: +878px portrait, +920px landscape. A sheet takes it out of the flow entirely, so the layout underneath never moves.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `web/guest/src/Contract.test.tsx`:

```tsx
  it('opens the data-protection notice over the screen, not inside it', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))

    const sheet = await screen.findByRole('dialog', { name: 'Datenschutzinformation' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(within(sheet).getByText(/Verantwortlicher/)).toBeInTheDocument()
  })

  it('closes the notice and leaves the box the guest already ticked alone', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    const box = document.querySelector('.privacy-check input') as HTMLInputElement
    await user.click(box)
    expect(box.checked).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))
    const sheet = await screen.findByRole('dialog', { name: 'Datenschutzinformation' })
    await user.click(within(sheet).getByRole('button', { name: 'Datenschutzinformation zuklappen' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Reading the notice must not undo the consent — the guest would have to
    // find and tick it a second time with no idea why.
    expect((document.querySelector('.privacy-check input') as HTMLInputElement).checked).toBe(true)
  })

  it('closes the notice on Escape', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))
    await screen.findByRole('dialog', { name: 'Datenschutzinformation' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
```

These tests need two things the file does not import yet: `within`, and `userEvent` (this suite has been driving the component with `fireEvent` only). Change:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
```

to:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm --prefix web/guest run test -- Contract`

Expected: FAIL — `Unable to find role="dialog"`.

- [ ] **Step 3: Write the sheet**

Create `web/guest/src/PrivacySheet.tsx`:

```tsx
import { useEffect, useRef } from 'react'

export interface PrivacySheetProps {
  text: string
  onClose: () => void
}

/**
 * The full data-protection notice, over the contract screen rather than inside
 * it. Inline it was the app's largest overflow — nearly 900px of text pushed
 * into a flow that has to fit a tablet — and, worse, opening it moved the
 * signature pad the guest was about to use.
 */
export default function PrivacySheet({ text, onClose }: PrivacySheetProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Focus starts on the way out. A guest on a tablet will tap it; a keyboard
  // user needs somewhere inside the dialog to be, or the next Tab walks the
  // page behind it.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      {/*
        The backdrop closes on tap; the sheet itself must not, or a guest
        dragging to scroll the notice would dismiss the thing they are reading.
      */}
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Datenschutzinformation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-body">
          <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
        </div>
        <div className="sheet-actions">
          <button ref={closeRef} type="button" className="btn secondary" onClick={onClose}>
            Datenschutzinformation zuklappen
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Call it from Contract**

In `web/guest/src/Contract.tsx`, add the import beside the others:

```tsx
import PrivacySheet from './PrivacySheet'
```

Then replace this block inside `.privacy-section`:

```tsx
              {privacyOpen && (
                <div className="privacy-text" role="region" aria-label="Datenschutzinformation">
                  <p style={{ whiteSpace: 'pre-wrap' }}>{privacyText}</p>
                </div>
              )}
```

with nothing — delete those five lines — and add the sheet as the last child of the `<section className="screen contract-screen">`, immediately before its closing `</section>`:

```tsx
      {privacyOpen && <PrivacySheet text={privacyText} onClose={() => setPrivacyOpen(false)} />}
```

The toggle button keeps both of its labels and its `aria-expanded`; nothing about `privacyAccepted` changes.

- [ ] **Step 5: Write the sheet CSS**

In `web/guest/src/index.css`, replace the `.privacy-text` rule:

```css
.privacy-text {
  max-height: 40vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 16px;
  font-size: 17px;
}
```

with:

```css
/* The notice, over the screen. Its own scroller, so a long text never reaches
   the layout underneath: opening it used to add ~900px to a page that has to
   fit a tablet, and moved the signature pad while it was at it. */
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(8, 25, 47, 0.6);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(100%, 760px);
  max-height: 100%;
  padding: 24px;
  border-radius: 20px;
  background: var(--panel-bg);
  text-align: left;
}

.sheet-body {
  min-height: 0;
  overflow-y: auto;
  font-size: 17px;
}

.sheet-actions {
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 6: Run the contract tests**

Run: `npm --prefix web/guest run test -- Contract`

Expected: PASS — the three new tests plus the seven that were already there. `shows the full data-protection notice on request` still passes: the notice text is on screen either way.

- [ ] **Step 7: Full guest suite, type check, lint**

Run: `npm --prefix web/guest run test`

Expected: PASS.

Run: `npm --prefix web/guest exec -- tsc -b --force`

Expected: no output, exit code 0.

Run: `npm --prefix web/guest run lint`

Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add web/guest/src/PrivacySheet.tsx web/guest/src/Contract.tsx \
        web/guest/src/Contract.test.tsx web/guest/src/index.css
git commit -m "feat(guest): read the data-protection notice over the screen, not in it"
```

---

### Task 4: The contract as a boarding pass

**Files:**
- Modify: `web/guest/src/Contract.tsx`
- Modify: `web/guest/src/Contract.test.tsx`
- Modify: `web/guest/src/index.css`

**Interfaces:**
- Consumes: the shell contract from Task 1, `StepTicks` from `./StepTicks`, `PrivacySheet` from Task 3.
- Produces: nothing later tasks depend on.

**The layout.** Portrait keeps one column; landscape splits at the perforation, which turns vertical:

```
  portrait 800x1280              landscape 1280x800
┌───────────────────────┐   ┌────────────────┊───────────────┐
│  contract text  (1fr) │   │                ┊ Datenschutz   │
│                       │   │ contract text  ┊ [x] gelesen   │
├╌╌╌╌╌ perforation ╌╌╌╌─┤   │      (1fr)     ┊               │
│  Datenschutz  [x]     │   │                ┊ Unterschrift  │
│  Unterschrift  ▁▁▁▁   │   │                ┊  ▁▁▁▁▁▁▁▁▁▁   │
└───────────────────────┘   └────────────────┊───────────────┘
        [Abbrechen] [Löschen] [Weiter]  — pinned, both orientations
```

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `web/guest/src/Contract.test.tsx`:

```tsx
  it('keeps the read gate shut until the contract has been scrolled to its end', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    const text = document.querySelector('.contract-text') as HTMLElement
    // jsdom reports every box as 0x0, so the "does it already fit?" effect has
    // to be defeated explicitly before the gate can be exercised at all.
    Object.defineProperty(text, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(text, 'clientHeight', { value: 400, configurable: true })
    fireEvent.scroll(text, { target: { scrollTop: 0 } })

    expect(screen.getByText(/Bitte den gesamten Vertrag lesen/)).toBeInTheDocument()

    fireEvent.scroll(text, { target: { scrollTop: 1600 } })

    expect(screen.queryByText(/Bitte den gesamten Vertrag lesen/)).not.toBeInTheDocument()
  })

  it('puts every action in the pinned band and the reading in the body', async () => {
    render(<Contract onNext={() => {}} onCancel={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    const actions = within(document.querySelector('.screen-actions') as HTMLElement)
    expect(actions.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Weiter' })).toBeInTheDocument()

    // The contract, the consent and the signature are one card in the body —
    // the band that is allowed to give when the keyboard takes the room.
    const body = document.querySelector('.screen-body') as HTMLElement
    expect(body.querySelector('.contract-text')).not.toBeNull()
    expect(body.querySelector('.privacy-check')).not.toBeNull()
    expect(body.querySelector('canvas.signature-pad')).not.toBeNull()
  })
```

`fireEvent` and `within` are both already imported by the end of Task 3 — no import change is needed here.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm --prefix web/guest run test -- Contract`

Expected: FAIL — `.screen-actions` is null.

- [ ] **Step 3: Restructure the contract screen**

In `web/guest/src/Contract.tsx`, add the `StepTicks` import beside the others:

```tsx
import StepTicks from './StepTicks'
```

Replace the opening of the returned JSX — from `<section className="screen contract-screen">` down to and including the `<div className="boarding-card">` line — with:

```tsx
    <section className="screen contract-screen">
      <div className="screen-head">
        <h1>Teilnahmebedingungen</h1>
        <StepTicks step={1} />
      </div>

      <div className="screen-body">
        <div className="boarding-card">
```

Then, at the end of the component, replace everything from the `</div>` that closes `.boarding-card` through to the closing `</section>` with:

```tsx
        </div>

        {errors && errors.length > 0 && (
          <ul className="error">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="screen-actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={submitting}>
            Abbrechen
          </button>
        )}
        <button type="button" className="btn secondary" onClick={handleClear} disabled={submitting}>
          Löschen
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!hasDrawn || !scrolledToEnd || !privacyAccepted || submitting}
          onClick={handleNext}
        >
          {submitting ? 'Wird gesendet…' : 'Weiter'}
        </button>
      </div>

      {privacyOpen && <PrivacySheet text={privacyText} onClose={() => setPrivacyOpen(false)} />}
    </section>
```

Now regroup the card's interior. In landscape the card becomes a flex **row**, so it must have exactly three children — one per column plus the tear between them. Today it has four (text, perforation, hint, privacy, sign), and the hint would become a column of its own.

Replace the entire interior of `<div className="boarding-card">` — everything between that opening tag and its matching `</div>` — with:

```tsx
          {/*
            One side of the tear: the contract and the hint that belongs to it.
            They are wrapped together because in landscape the card's children
            are its columns, and the hint is not a column — it is a caption on
            the text above it.
          */}
          <div className="card-main">
            <div
              ref={textRef}
              className="contract-text"
              role="region"
              aria-label="Teilnahmebedingungen"
              onScroll={handleScroll}
            >
              {loading && <p>Lade Vertragstext…</p>}
              {!loading && loadError && <p className="error">{loadError}</p>}
              {!loading && !loadError && text.trim().length === 0 && (
                <p>Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.</p>
              )}
              {!loading && !loadError && text.trim().length > 0 && (
                <p style={{ whiteSpace: 'pre-wrap' }}>{renderWithBoldPhrases(text)}</p>
              )}
            </div>

            {!scrolledToEnd && (
              <p className="scroll-hint">
                Bitte den gesamten Vertrag lesen — nach unten scrollen, um fortzufahren.
              </p>
            )}
          </div>

          <div className="perforation" />

          {/* The other side: everything the guest does rather than reads. */}
          <div className="card-stub">
            {/*
              Above the signature, because it has to be read before signing — and
              separate from the contract text beside it, because that is the whole
              point of pulling it out of the contract.
            */}
            <div className="privacy-section">
              <h2>Datenschutz</h2>
              <p>
                Wir verarbeiten deine Daten, um deinen Tandemsprung durchzuführen und abzurechnen.
                Die vollständige Datenschutzinformation kannst du hier aufklappen.
              </p>

              {privacyText.trim().length === 0 ? (
                <p className="error">
                  Die Datenschutzinformation konnte nicht geladen werden. Bitte wende dich an das
                  Personal.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn secondary privacy-toggle"
                    aria-expanded={privacyOpen}
                    onClick={() => setPrivacyOpen((open) => !open)}
                  >
                    {privacyOpen ? 'Datenschutzinformation zuklappen' : 'Datenschutzinformation lesen'}
                  </button>

                  <label className="privacy-check">
                    <input
                      type="checkbox"
                      checked={privacyAccepted}
                      onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    />
                    Ich habe die Datenschutzinformation gelesen und stimme der Verarbeitung meiner
                    Daten zur Abwicklung des Tandemsprungs zu.
                  </label>
                </>
              )}
            </div>

            <div className="sign-section">
              <h2>Unterschrift</h2>
              <p>Mit deiner Unterschrift bestätigst du, den Vertrag gelesen und akzeptiert zu haben.</p>
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="signature-pad"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDrawing}
                onPointerLeave={stopDrawing}
                onPointerCancel={stopDrawing}
              />
            </div>
          </div>
```

Note what did **not** change: every German string, the `.contract-text` ref and scroll handler, the `.scroll-hint` wording, the `.privacy-check` input, and all six canvas pointer handlers.

- [ ] **Step 4: Write the boarding-pass CSS**

In `web/guest/src/index.css`, replace the `.boarding-card` rule:

```css
.boarding-card {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--panel-bg);
  overflow: hidden;
  margin-bottom: 8px;
}
```

with:

```css
/* The card is the screen's body now, not a block inside it: it takes the height
   there is and hands it to the contract text, which is the only part with more
   to show than fits. */
.boarding-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--panel-bg);
  overflow: hidden;
}
```

Replace the `.contract-text` rule:

```css
.contract-text {
  width: 100%;
  max-height: 40vh;
  overflow-y: auto;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 24px;
  font-size: 18px;
}
```

with:

```css
/* Takes whatever height the card has left and scrolls inside it. This is the
   one scroller the guest is *meant* to use — it is the read gate. */
.contract-text {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  text-align: left;
  background: var(--panel-bg);
  padding: 20px 24px;
  font-size: 18px;
}
```

The `.boarding-card .contract-text` override that used to strip the border and margin is now redundant — delete it:

```css
.boarding-card .contract-text {
  border: none;
  border-radius: 0;
  margin: 0;
}
```

Add the stub, and the landscape split, after the `.boarding-card .privacy-section` rule:

```css
/* The read side of the tear: the contract plus the hint captioning it. */
.card-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

/* Everything the guest does rather than reads. In portrait it sits below the
   tear; in landscape it *is* the stub, beside it. It scrolls on its own so a
   long consent sentence can never push the signature pad out of the card. */
.card-stub {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
}

.boarding-card .privacy-section,
.boarding-card .sign-section {
  padding: 20px 24px;
}

/*
 * Landscape: the tear runs vertically and the card reads like the boarding pass
 * it is drawn as — the contract on the wide side, the part you sign on the
 * stub. Portrait keeps the horizontal tear, which is the only way two full-width
 * blocks can share a narrow screen.
 */
@media (orientation: landscape) {
  .boarding-card {
    flex-direction: row;
  }

  /* The contract gets the wide side; the stub gets enough for a signature. */
  .card-main {
    flex: 1 1 58%;
  }

  .card-stub {
    flex: 1 1 42%;
  }

  .boarding-card .perforation {
    height: auto;
    width: 0;
    border-top: none;
    border-left: 2px dashed var(--border);
  }

  /* The two punched notches turn with the tear: top and bottom instead of
     left and right. */
  .boarding-card .perforation::before,
  .boarding-card .perforation::after {
    top: auto;
    left: -10px;
    right: auto;
  }

  .boarding-card .perforation::before {
    top: -10px;
  }

  .boarding-card .perforation::after {
    bottom: -10px;
  }

  /* The privacy block loses its rule in landscape: the vertical tear beside it
     already separates it from the contract, and a second line would only box
     it in. */
  .boarding-card .privacy-section {
    border-top: none;
  }
}
```

Finally, delete the `.actions` rule. Task 1 left it in place because `Form` and `Contract` still used it; this task moved the last of those two call sites onto `.screen-actions`, so nothing references it any more:

```css
.actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 24px;
}
```

Confirm before deleting: `grep -rn "className=\"actions\"" web/guest/src/` must print nothing.

- [ ] **Step 5: Run the contract tests**

Run: `npm --prefix web/guest run test -- Contract`

Expected: PASS — 12 tests.

- [ ] **Step 6: Full guest suite, type check, lint**

Run: `npm --prefix web/guest run test`

Expected: PASS.

Run: `npm --prefix web/guest exec -- tsc -b --force`

Expected: no output, exit code 0.

Run: `npm --prefix web/guest run lint`

Expected: no output, exit code 0.

- [ ] **Step 7: Check the flow end to end**

Run: `npm run build:web` then `npx playwright test tests/e2e/flow.spec.ts`

Expected: PASS — 1 test. This spec drives the real contract screen: it asserts `.scroll-hint` appears and then disappears, scrolls `.contract-text` by script, draws on `canvas.signature-pad` and ticks `.privacy-check input`. All four selectors must still resolve.

- [ ] **Step 8: Commit**

```bash
git add web/guest/src/Contract.tsx web/guest/src/Contract.test.tsx web/guest/src/index.css
git commit -m "feat(guest): tear the contract card along its perforation in landscape"
```

---

### Task 5: A signature pad that fits its stub

**Files:**
- Modify: `web/guest/src/Contract.test.tsx`
- Modify: `web/guest/src/index.css`

**Interfaces:**
- Consumes: `.card-stub` from Task 4.
- Produces: nothing.

**Why this is CSS only.** The canvas is 700×280 in its backing store and `point()` already maps pointer coordinates through `canvas.width / rect.width`, so drawing is correct at any displayed size. What is missing is a displayed size that suits the stub: `max-width: 100%` alone leaves it 280px tall in a column that may only be 200px, and never lets it use a wider stub.

- [ ] **Step 1: Write the failing test**

Append to the `describe` block in `web/guest/src/Contract.test.tsx`:

```tsx
  it('keeps the signature image at the size the contract PDF stamps', async () => {
    render(<Contract onNext={() => {}} />)
    await screen.findByText(/Der Tandempassagier/)

    // The pad is displayed at whatever width its column has, but the PNG that
    // goes to the server must not change size with it — src/server/contractPdf.ts
    // places it at fixed dimensions.
    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    expect(canvas.width).toBe(700)
    expect(canvas.height).toBe(280)
  })
```

- [ ] **Step 2: Run it**

Run: `npm --prefix web/guest run test -- Contract`

Expected: PASS immediately — this is a lock, not a change. It exists so a later "make the canvas responsive" edit that rewrites the backing store has to argue with a test instead of silently changing what the PDF receives.

- [ ] **Step 3: Size the pad to its column**

In `web/guest/src/index.css`, replace:

```css
/* Signature pad (contract screen) */
.signature-pad {
  border: 2px solid var(--border);
  border-radius: 12px;
  background: #fff;
  touch-action: none;
  max-width: 100%;
  margin-bottom: 8px;
}
```

with:

```css
/* Signature pad (contract screen). Displayed at the stub's width and the 700x280
   aspect its backing store has, so the stroke is never stretched; the backing
   store itself stays 700x280 whatever the display size, because that is what
   src/server/contractPdf.ts stamps. `point()` maps between the two. */
.signature-pad {
  width: 100%;
  height: auto;
  aspect-ratio: 700 / 280;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: #fff;
  touch-action: none;
}
```

- [ ] **Step 4: Run the guest suite, type check, lint**

Run: `npm --prefix web/guest run test`

Expected: PASS.

Run: `npm --prefix web/guest exec -- tsc -b --force`

Expected: no output, exit code 0.

Run: `npm --prefix web/guest run lint`

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add web/guest/src/Contract.test.tsx web/guest/src/index.css
git commit -m "feat(guest): size the signature pad to the stub it sits on"
```

---

### Task 6: The gate that holds it to the tablet

**Files:**
- Create: `tests/e2e/guest-fits.spec.ts`

**Interfaces:**
- Consumes: `.screen-body` and `.screen-actions` from Task 1 — the whole point of those class names is that this spec can address them.
- Produces: the acceptance criterion for the plan.

**Why a Playwright spec and not a unit test.** jsdom reports every box as 0×0, so no unit test can tell whether anything fits. This is also the gate the manifest redesign did not have: that branch shipped a broken `tests/e2e/flow.spec.ts` through five task reviews because nothing in its checklist ran Playwright.

- [ ] **Step 1: Write the failing spec**

Create `tests/e2e/guest-fits.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// The guest app runs on a Lenovo Tab 11 handed to a guest. Every screen has to
// fit it in whichever way the guest happens to be holding it — the operator
// cannot lean over and scroll for them.
//
// 1280x800 is the CSS-pixel size of a Tab M11 (1920x1200 at dpr 1.5). A Tab P11
// is 1333x800 — wider, same height — so passing here passes there too.
const ORIENTATIONS = [
  { name: 'hochkant', width: 800, height: 1280 },
  { name: 'quer', width: 1280, height: 800 },
]

const GUEST = {
  firstName: 'Max', lastName: 'Mustermann', gender: 'männlich', age: '30',
  height: '182', weight: '85', street: 'Musterstraße 1', postalCode: '4240',
  city: 'Freistadt', email: 'max@example.at', phone: '0660123456',
}

async function expectFits(page: Page, label: string) {
  // Two separate claims. The body must not be scrollable at all — that is what
  // "no scrolling" means. And the action band must be inside the window, which
  // is what the guest actually needs: the way on is always in sight.
  const body = await page.locator('.screen-body').boundingBox()
  const overflow = await page.locator('.screen-body').evaluate(
    (el) => el.scrollHeight - el.clientHeight
  )
  expect(overflow, `${label}: der Inhalt ragt ${overflow}px über den Bildschirm hinaus`)
    .toBeLessThanOrEqual(1)
  expect(body, `${label}: kein .screen-body gefunden`).not.toBeNull()

  const actions = await page.locator('.screen-actions').boundingBox()
  if (actions) {
    const viewport = page.viewportSize()
    expect(actions.y + actions.height, `${label}: die Schaltflächen liegen unterhalb des Bildschirms`)
      .toBeLessThanOrEqual(viewport!.height)
  }
}

for (const o of ORIENTATIONS) {
  test(`die Gast-Anmeldung passt auf ein Lenovo Tab 11 (${o.name})`, async ({ page }) => {
    await page.setViewportSize({ width: o.width, height: o.height })
    await page.goto('/guest/')

    await expectFits(page, `${o.name} / Willkommen`)

    await page.getByRole('button', { name: 'Anmeldung starten' }).click()
    await expectFits(page, `${o.name} / Deine Daten`)

    await page.getByLabel('Vorname').fill(GUEST.firstName)
    await page.getByLabel('Nachname').fill(GUEST.lastName)
    await page.getByRole('radio', { name: GUEST.gender }).check()
    await page.getByLabel('Alter').fill(GUEST.age)
    await page.getByLabel('Größe (cm)').fill(GUEST.height)
    await page.getByLabel('Gewicht (kg)').fill(GUEST.weight)
    await page.getByLabel('Straße und Hausnummer').fill(GUEST.street)
    await page.getByLabel('PLZ').fill(GUEST.postalCode)
    await page.getByLabel('Wohnort').fill(GUEST.city)
    await page.getByLabel('E-Mail').fill(GUEST.email)
    await page.getByLabel('Telefon').fill(GUEST.phone)

    // Filled in, every field also shows its value — and an error line under a
    // field is exactly the growth that would push the screen over.
    await expectFits(page, `${o.name} / Deine Daten (ausgefüllt)`)

    await page.getByRole('button', { name: 'Weiter' }).click()
    await expect(page.getByRole('heading', { name: 'Teilnahmebedingungen' })).toBeVisible()
    await expectFits(page, `${o.name} / Teilnahmebedingungen`)

    // The notice opens over the screen, so the screen underneath must be
    // exactly as it was.
    await page.getByRole('button', { name: 'Datenschutzinformation lesen' }).click()
    await expect(page.getByRole('dialog', { name: 'Datenschutzinformation' })).toBeVisible()
    await expectFits(page, `${o.name} / Teilnahmebedingungen (Datenschutz offen)`)

    await page.getByRole('button', { name: 'Datenschutzinformation zuklappen' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}
```

- [ ] **Step 2: Build and run it**

Run: `npm run build:web` then `npx playwright test tests/e2e/guest-fits.spec.ts`

Expected: PASS — 2 tests. If either fails, the failure message names the screen, the orientation and the number of pixels over; fix the layout for that screen rather than loosening the assertion.

- [ ] **Step 3: Prove the gate is not vacuous**

Temporarily add this to the end of `web/guest/src/index.css`:

```css
.screen-body { min-height: 3000px; }
```

Run: `npm run build:web` then `npx playwright test tests/e2e/guest-fits.spec.ts`

Expected: FAIL on the first `expectFits`, reporting a large positive overflow.

**Then delete that rule**, rebuild, and re-run to confirm PASS. Do not commit it.

- [ ] **Step 4: Run everything**

Run: `npm --prefix web/guest run test`

Expected: PASS.

Run: `npm test`

Expected: PASS — 267 tests.

Run: `npx playwright test`

Expected: PASS — 3 tests (`flow.spec.ts` plus the two orientations here).

Run: `npm run build:all`

Expected: exit code 0, `tandem.exe` packaged.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/guest-fits.spec.ts
git commit -m "test(e2e): hold the guest app to a Lenovo Tab 11 in both orientations"
```

---

## Verification checklist

Before the branch is considered done:

- [ ] `npm --prefix web/guest run test` — all guest unit tests pass
- [ ] `npm --prefix web/guest exec -- tsc -b --force` — exit 0
- [ ] `npm --prefix web/guest run lint` — exit 0
- [ ] `npm test` — 267 tests pass
- [ ] `npx playwright test` — 3 tests pass, including both orientations of `guest-fits.spec.ts`
- [ ] `npm run build:all` — exit 0
- [ ] Looked at, not just measured: screenshots of all four screens in both orientations, checked for a signature pad squeezed flat, a radio row that has wrapped to two lines, or an error message that has pushed a column past its neighbour
