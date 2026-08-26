import { test, expect } from '@playwright/test'
import { today as localToday } from '../../src/server/day'

test.use({ viewport: { width: 1440, height: 900 } })

test('the Vertragstext is shown with its bold passages and can be formatted', async ({ page }) => {
  await page.goto('/manifest/')
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.getByRole('tab', { name: 'Vertragstext' }).click()

  const panel = page.getByRole('tabpanel', { name: 'Vertrag' })
  const preview = panel.locator('.text-preview')

  // The four passages the club's paper contract prints bold.
  await expect(preview.locator('strong')).toHaveCount(4)
  await expect(preview.locator('strong').first()).toHaveText('Absprung:')
  // The markers belong in the editor, not in what the guest gets to read.
  await expect(preview).not.toContainText('**')
  await expect(panel.getByLabel('Vertragstext')).toHaveValue(/\*\*Absprung:\*\*/)

  // Marking a selection bold goes through the button, and shows up in both.
  const area = panel.getByLabel('Vertragstext')
  await area.evaluate((el: HTMLTextAreaElement) => {
    el.focus()
    const at = el.value.indexOf('Hohlkreuz')
    el.setSelectionRange(at, at + 9)
  })
  await panel.getByRole('button', { name: /Fett/ }).click()

  await expect(area).toHaveValue(/\*\*Hohlkreuz\*\*/)
  await expect(preview.locator('strong')).toHaveCount(5)
})

test('the guest reads the contract with the bold passages, not the markers', async ({ page }) => {
  await page.goto('/guest/')
  await page.getByRole('button', { name: 'Anmeldung starten' }).click()
  for (const [label, value] of [
    ['Vorname', 'Max'],
    ['Nachname', 'Mustermann'],
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

  const text = page.locator('.contract-text')
  await expect(text.locator('strong').first()).toHaveText('Absprung:')
  await expect(text).not.toContainText('**')
})

test('the manifest keeps the chosen day, and "Heute" brings it back', async ({ page }) => {
  await page.goto('/manifest/')
  const dateField = () => page.getByLabel('Datum')
  const today = localToday()

  await expect(dateField()).toHaveValue(today)

  await dateField().fill('2026-07-09')
  await expect(page.getByText('Keine Registrierungen für dieses Datum.')).toBeVisible()

  // Leaving the screen used to be what lost the day: List is unmounted here.
  await page.getByRole('button', { name: 'Stammdaten' }).click()
  await page.getByRole('button', { name: 'Manifest' }).click()
  await expect(dateField()).toHaveValue('2026-07-09')

  // And so did a reload of the window.
  await page.reload()
  await expect(dateField()).toHaveValue('2026-07-09')

  await page.getByRole('button', { name: 'Heute' }).click()
  await expect(dateField()).toHaveValue(today)
  await expect(page.getByRole('button', { name: 'Heute' })).toBeDisabled()
})
