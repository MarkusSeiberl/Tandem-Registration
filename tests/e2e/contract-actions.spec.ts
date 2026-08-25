import { test, expect } from '@playwright/test'

const GUEST = {
  Vorname: 'Max',
  Nachname: 'Mustermann',
  Alter: '30',
  'Größe (cm)': '182',
  'Gewicht (kg)': '85',
  'Straße und Hausnummer': 'Musterstraße 1',
  PLZ: '4240',
  Wohnort: 'Freistadt',
  'E-Mail': 'max@example.at',
  Telefon: '0660123456',
}

test.use({ viewport: { width: 1200, height: 800 } })

async function toContract(page: import('@playwright/test').Page) {
  await page.goto('/guest/')
  await page.getByRole('button', { name: 'Anmeldung starten' }).click()
  for (const [label, value] of Object.entries(GUEST)) {
    await page.getByLabel(label).fill(value)
  }
  await page.getByRole('radio', { name: 'männlich' }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.locator('.contract-text')).toBeVisible()
}

test('"Zurück" returns to the form with everything still in it', async ({ page }) => {
  await toContract(page)

  await page.getByRole('button', { name: 'Zurück' }).click()
  await expect(page.getByRole('heading', { name: 'Deine Daten' })).toBeVisible()

  for (const [label, value] of Object.entries(GUEST)) {
    await expect(page.getByLabel(label)).toHaveValue(value)
  }
  await expect(page.getByRole('radio', { name: 'männlich' })).toBeChecked()

  // A correction carries through to the contract screen and back again.
  await page.getByLabel('Wohnort').fill('Linz')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.locator('.contract-text')).toBeVisible()
  await page.getByRole('button', { name: 'Zurück' }).click()
  await expect(page.getByLabel('Wohnort')).toHaveValue('Linz')
})

test('sending without the data-protection box marks it instead of doing nothing', async ({
  page,
}) => {
  await toContract(page)

  // Read to the end and sign, but leave the box untouched.
  await page.locator('.contract-end').scrollIntoViewIfNeeded()
  await expect(page.locator('.scroll-hint')).toBeHidden()

  const canvas = page.locator('canvas.signature-pad')
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('signature canvas has no bounding box')
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 70)
  await page.mouse.up()

  const send = page.getByRole('button', { name: 'Anmeldung abschicken' })
  // The button is pressable — that is what lets it say what is missing.
  await expect(send).toBeEnabled()
  await send.click()

  const check = page.locator('.privacy-check input')
  await expect(check).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.privacy-check')).toHaveClass(/missing/)
  await expect(
    page.getByText('Bitte bestätige die Datenschutzinformation, um fortzufahren.')
  ).toBeVisible()
  // Marked and brought into view, with the focus already on it.
  await expect(check).toBeInViewport()
  await expect(check).toBeFocused()

  await check.check()
  await expect(
    page.getByText('Bitte bestätige die Datenschutzinformation, um fortzufahren.')
  ).toBeHidden()
})

test('"Unterschrift löschen" sits with the pad it clears', async ({ page }) => {
  await toContract(page)

  const clear = page.getByRole('button', { name: 'Unterschrift löschen' })
  const canvas = page.locator('canvas.signature-pad')
  await canvas.scrollIntoViewIfNeeded()

  // Nothing drawn yet: nothing to clear.
  await expect(clear).toBeDisabled()

  const box = await canvas.boundingBox()
  if (!box) throw new Error('signature canvas has no bounding box')
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 70)
  await page.mouse.up()
  await expect(clear).toBeEnabled()

  // Directly under the pad, and well above the row of buttons that leave the
  // screen — that adjacency is the whole point of moving it.
  const padBox = (await canvas.boundingBox())!
  const clearBox = (await clear.boundingBox())!
  const sendBox = (await page.getByRole('button', { name: 'Anmeldung abschicken' }).boundingBox())!
  expect(clearBox.y).toBeGreaterThan(padBox.y + padBox.height - 4)
  expect(clearBox.y + clearBox.height).toBeLessThan(sendBox.y)

  await clear.click()
  await expect(clear).toBeDisabled()
})
