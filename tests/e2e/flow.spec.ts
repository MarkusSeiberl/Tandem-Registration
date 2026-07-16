import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'

// Full happy path: a guest registers via the kiosk app, the manifest PC
// sees the row immediately, the operator fills in manifest fields and
// saves, and the day's export produces a real xlsx on disk with the
// guest's row in it.

const GUEST = {
  firstName: 'Max',
  lastName: 'Mustermann',
  age: '30',
  weight: '85',
  address: 'Musterstraße 1',
  email: 'max@example.at',
  phone: '0660123456',
}

test('guest registration flows through to manifest and xlsx export', async ({ page }) => {
  // --- Guest kiosk: welcome -> contract -> form -> sign -> done ---
  // Trailing slash required: @fastify/static serves the SPA's index.html at
  // the prefix root ('/guest/') but does not redirect the bare prefix
  // ('/guest') to it, so the bare path 404s.
  await page.goto('/guest/')

  await page.getByRole('button', { name: 'Anmeldung starten' }).click()

  await expect(page.getByRole('heading', { name: 'Teilnahmebedingungen' })).toBeVisible()
  await page.getByLabel('Ich akzeptiere die Bedingungen').check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.getByLabel('Vorname').fill(GUEST.firstName)
  await page.getByLabel('Nachname').fill(GUEST.lastName)
  await page.getByLabel('Alter').fill(GUEST.age)
  await page.getByLabel('Gewicht (kg)').fill(GUEST.weight)
  await page.getByLabel('Adresse').fill(GUEST.address)
  await page.getByLabel('E-Mail').fill(GUEST.email)
  await page.getByLabel('Telefon').fill(GUEST.phone)

  const formWeiter = page.getByRole('button', { name: 'Weiter' })
  await expect(formWeiter).toBeEnabled()
  await formWeiter.click()

  // Draw a real multi-segment signature stroke on the canvas so `hasDrawn`
  // flips true and the PNG isn't blank.
  const canvas = page.locator('canvas.signature-pad')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('signature canvas has no bounding box')
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 60)
  await page.mouse.move(box.x + 150, box.y + 30)
  await page.mouse.move(box.x + 220, box.y + 90)
  await page.mouse.up()

  const signWeiter = page.getByRole('button', { name: 'Weiter' })
  await expect(signWeiter).toBeEnabled()

  const [submitResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/registrations') && r.request().method() === 'POST'
    ),
    signWeiter.click(),
  ])
  expect(submitResponse.status()).toBe(201)

  await expect(page.getByRole('heading', { name: 'Vielen Dank!' })).toBeVisible()

  // --- Manifest PC: list shows the new row ---
  await page.goto('/manifest/')

  const fullName = `${GUEST.firstName} ${GUEST.lastName}`
  const row = page.locator('tr.clickable-row', { hasText: fullName })
  await expect(row).toBeVisible()
  await row.click()

  await expect(page.getByRole('heading', { name: 'Manifest' })).toBeVisible()
  await page.getByLabel('Load-Nr.').fill('5')
  await page.getByLabel('Preis').fill('250')
  await page.getByLabel('Zahlungsart').selectOption('card')
  await page.getByLabel('Zusatzbuchung').selectOption('video_photo')

  const [patchResponse] = await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/registrations\/\d+/.test(r.url()) && r.request().method() === 'PATCH'
    ),
    page.getByRole('button', { name: 'Speichern' }).click(),
  ])
  expect(patchResponse.status()).toBe(200)
  await expect(page.getByText('Gespeichert.')).toBeVisible()

  await page.getByRole('button', { name: /Zurück/ }).click()

  // Re-fetch confirms the PATCH actually persisted server-side, not just
  // local component state.
  const updatedRow = page.locator('tr.clickable-row', { hasText: fullName })
  await expect(updatedRow).toBeVisible()
  await expect(updatedRow).toContainText('Karte')
  await expect(updatedRow).toContainText('Video+Foto')
  await expect(updatedRow.locator('td').nth(4)).toHaveText('5')

  // --- Export the day and verify the real xlsx on disk ---
  const [exportResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/export') && r.request().method() === 'POST'
    ),
    page.getByRole('button', { name: /Exportieren/ }).click(),
  ])
  expect(exportResponse.status()).toBe(200)
  const exportJson = (await exportResponse.json()) as { path: string; count: number }
  expect(exportJson.count).toBeGreaterThan(0)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(exportJson.path)
  const ws = wb.worksheets[0]
  const serializedRows: string[] = []
  ws.eachRow((r) => serializedRows.push(JSON.stringify(r.values)))
  const found = serializedRows.some(
    (r) => r.includes(GUEST.firstName) && r.includes(GUEST.lastName)
  )
  expect(found).toBe(true)
})
