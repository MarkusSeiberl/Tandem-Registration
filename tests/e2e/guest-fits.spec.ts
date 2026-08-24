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

  // A third claim, and the one that caught the real bug: nothing *inside* the
  // body may quietly become a scroller of its own. The body itself measured
  // clean while the boarding pass' stub was 85px over and hid the signature pad
  // behind its own scrollbar — a pad the guest could only reach by scrolling,
  // which is the thing this layout exists to remove. The contract text is the
  // one sanctioned exception: scrolling it IS the read gate.
  const nested = await page.locator('.screen-body').evaluate((root) =>
    [...root.querySelectorAll('*')]
      .filter((e) => {
        const el = e as HTMLElement
        const overflow = getComputedStyle(el).overflowY
        return (
          (overflow === 'auto' || overflow === 'scroll') &&
          el.scrollHeight > el.clientHeight + 1 &&
          !el.classList.contains('contract-text')
        )
      })
      .map((e) => {
        const el = e as HTMLElement
        return `${el.className} (+${el.scrollHeight - el.clientHeight}px)`
      })
  )
  expect(nested, `${label}: etwas innerhalb der Seite scrollt für sich`).toEqual([])
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
    // The data-protection notice arrives from the server after the screen does,
    // and it brings the consent box and the button with it. Measured before it
    // lands, this screen is 92px shorter than the one the guest actually sees.
    await page.locator('.privacy-check input').waitFor()
    await expectFits(page, `${o.name} / Teilnahmebedingungen`)

    // The notice opens over the screen, so the screen underneath must be
    // exactly as it was.
    await page.getByRole('button', { name: 'Datenschutzinformation lesen' }).click()
    await expect(page.getByRole('dialog', { name: 'Datenschutzinformation' })).toBeVisible()
    await expectFits(page, `${o.name} / Teilnahmebedingungen (Datenschutz offen)`)

    // Scoped to the sheet: while it is open the toggle behind it carries the
    // same label — the plan reuses the existing string rather than inventing
    // German copy for a second control.
    await page
      .getByRole('dialog', { name: 'Datenschutzinformation' })
      .getByRole('button', { name: 'Datenschutzinformation zuklappen' })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}
