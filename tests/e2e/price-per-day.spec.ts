import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// The bug this pins, end to end: the price table said 270, a guest registered at
// 270, the table was changed to 280 — and the detail screen then said 280 while
// the list still said 270. A jump now costs what its day costs, on every screen.
//
// One test rather than three: the e2e server keeps its database for the whole
// run, and a jump day is frozen by whichever registration reaches it first, so
// separate tests would each be starting mid-story.

test.use({ viewport: { width: 1440, height: 900 } })

const today = () => new Date().toISOString().slice(0, 10)

async function registerGuest(page: Page, firstName: string) {
  await page.goto('/guest/')
  await page.getByRole('button', { name: 'Anmeldung starten' }).click()
  for (const [label, value] of [
    ['Vorname', firstName],
    ['Nachname', 'Preistag'],
    ['Alter', '30'],
    ['Größe (cm)', '182'],
    ['Gewicht (kg)', '85'],
    ['Straße und Hausnummer', 'Musterstraße 1'],
    ['PLZ', '4240'],
    ['Wohnort', 'Freistadt'],
    ['E-Mail', 'max@example.at'],
    ['Telefon', '0660123456'],
  ]) {
    await page.getByLabel(label).fill(value)
  }
  await page.getByRole('radio', { name: 'männlich' }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.locator('.contract-end').scrollIntoViewIfNeeded()
  const canvas = page.locator('canvas.signature-pad')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 70)
  await page.mouse.up()
  await page.locator('.privacy-check input').check()
  await page.getByRole('button', { name: 'Anmeldung abschicken' }).click()
  await expect(page.getByRole('heading', { name: 'Vielen Dank!' })).toBeVisible()
}

// The price table lives under Stammdaten, next to the payout rates.
async function setJumpPrice(page: Page, amount: string) {
  await page.goto('/manifest/')
  await page.getByRole('button', { name: 'Stammdaten' }).click()
  await page.getByLabel('Tandemsprung').fill(amount)
  await page.getByRole('button', { name: 'Beträge speichern' }).click()
  await expect(page.getByText('Gespeichert.')).toBeVisible()
}

// Several columns hold numbers, so the price is read from the guest's own row.
// Filtered by text, because a <tr> takes no accessible name from its cells.
const guestRow = (page: Page, name: string) =>
  page.locator('tbody tr').filter({ hasText: name })

test('a jump costs what its day costs, on every screen', async ({ page }) => {
  await setJumpPrice(page, '270')
  // Another spec may have started today already; this puts the day on 270 no
  // matter who got here first, the same way the operator's button does.
  await page.request.post(`/api/day-tables/${today()}/reprice`)

  await registerGuest(page, 'Erste')
  await page.goto('/manifest/')
  await expect(guestRow(page, 'Erste Preistag')).toContainText('270 €')

  // The club raises the price while the day is running.
  await setJumpPrice(page, '280')
  await page.getByRole('button', { name: 'Manifest' }).click()

  // Nothing about the day moves — not the row already there…
  await expect(guestRow(page, 'Erste Preistag')).toContainText('270 €')
  // …and not a guest who signs after the change.
  await registerGuest(page, 'Zweite')
  await page.goto('/manifest/')
  await expect(guestRow(page, 'Zweite Preistag')).toContainText('270 €')

  // The detail screen agrees with the list — this is what it got wrong before.
  await page.getByText('Erste Preistag').click()
  await expect(page.locator('.price-total .numeral')).toHaveText('270 €')
  await expect(page.getByText(/Preisliste vom Tagesbeginn/)).toBeVisible()

  // And saving the row for an unrelated reason does not re-price it either.
  await page.getByLabel('Load-Nr.').fill('3')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('.price-total .numeral')).toHaveText('270 €')
  await page.getByRole('button', { name: '← Zurück' }).click()
  await expect(guestRow(page, 'Erste Preistag')).toContainText('270 €')

  // The whole day can be moved onto the new prices, deliberately.
  await expect(page.getByText(/läuft auf der Preisliste von seinem Beginn/)).toBeVisible()
  await page.getByRole('button', { name: 'Preise für diesen Tag aktualisieren' }).click()

  await expect(guestRow(page, 'Erste Preistag')).toContainText('280 €')
  await expect(guestRow(page, 'Zweite Preistag')).toContainText('280 €')
  await expect(page.getByText(/läuft auf der Preisliste von seinem Beginn/)).toBeHidden()

  await page.getByText('Erste Preistag').click()
  await expect(page.locator('.price-total .numeral')).toHaveText('280 €')
})
