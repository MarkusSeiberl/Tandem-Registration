import { test, expect } from '@playwright/test'
import ExcelJS from 'exceljs'

// Full happy path: a guest registers via the kiosk app, the manifest PC
// sees the row immediately, the operator fills in manifest fields and
// saves, and the day's export produces a real xlsx on disk with the
// guest's row in it.

const GUEST = {
  firstName: 'Max',
  lastName: 'Mustermann',
  gender: 'männlich',
  age: '30',
  height: '182',
  weight: '85',
  street: 'Musterstraße 1',
  postalCode: '4240',
  city: 'Freistadt',
  email: 'max@example.at',
  phone: '0660123456',
}

test('guest registration flows through to manifest and xlsx export', async ({ page }) => {
  // --- Guest kiosk: welcome -> form -> contract (+ signature) -> done ---
  // Trailing slash required: @fastify/static serves the SPA's index.html at
  // the prefix root ('/guest/') but does not redirect the bare prefix
  // ('/guest') to it, so the bare path 404s.
  await page.goto('/guest/')

  await page.getByRole('button', { name: 'Anmeldung starten' }).click()

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

  const formWeiter = page.getByRole('button', { name: 'Weiter' })
  await expect(formWeiter).toBeEnabled()
  await formWeiter.click()

  await expect(page.getByRole('heading', { name: 'Teilnahmebedingungen' })).toBeVisible()

  // Proof-of-reading gate: before scrolling, the hint is shown and "Weiter"
  // stays locked. Scrolling the contract text to the end clears the hint.
  await expect(page.locator('.scroll-hint')).toBeVisible()
  await page.locator('.contract-text').evaluate((el) => {
    el.scrollTo(0, el.scrollHeight)
  })
  await expect(page.locator('.scroll-hint')).toBeHidden()

  // Draw a real multi-segment signature stroke on the canvas so `hasDrawn`
  // flips true and the PNG isn't blank. Signing this screen submits directly —
  // there is no later sign screen anymore.
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
  // Signing is not enough on its own: the data-protection notice has to be
  // acknowledged as a separate act before the registration can be sent.
  await expect(signWeiter).toBeDisabled()
  await page.locator('.privacy-check input').check()
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

  // The manifest fields no longer sit under one "Manifest" heading — they are
  // split across the three panels named for the decisions this screen makes.
  // Landing on the screen means all three are there.
  await expect(page.getByRole('heading', { name: 'Zuteilung' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Leistung' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kassa' })).toBeVisible()

  // The guest's new fields must have survived the trip to the server.
  await expect(page.getByText('männlich')).toBeVisible()
  await expect(page.getByText('182 cm')).toBeVisible()
  await expect(page.getByText(`${GUEST.postalCode} ${GUEST.city}`)).toBeVisible()

  await page.getByLabel('Load-Nr.').fill('5')

  // Gutschein-Nr. and the covered service exist only while Gutschein is the
  // chosen payment method.
  const voucherField = page.getByLabel('Gutschein-Nr.')
  const voucherService = page.getByLabel('Gutschein-Leistung')
  const voucherTill = page.getByLabel('Zuzahlung bezahlt mit')
  await expect(voucherField).toBeHidden()
  await expect(voucherService).toBeHidden()
  await page.getByLabel('Zahlungsart').selectOption('voucher')
  await expect(voucherField).toBeVisible()
  await expect(voucherService).toBeVisible()

  // A voucher used exactly as issued costs nothing, so the till is locked and
  // says why; upgrading to video+photo leaves 20 € that has to land somewhere.
  await voucherService.selectOption('jump_video')
  await expect(voucherTill).toBeDisabled()
  await expect(page.locator('.voucher-status'))
    .toHaveText('Gutschein deckt alles ab — nichts zu kassieren.')
  await page.getByLabel('Gebuchte Leistung').selectOption('video_photo')
  await expect(voucherTill).toBeEnabled()
  await expect(page.locator('.voucher-status')).toHaveText('Noch 20 € offen — bitte Kassa wählen.')
  await expect(page.locator('.price-total .numeral')).toHaveText('20 €')

  // Leaving the voucher takes the whole block with it, in one visible step.
  await page.getByLabel('Zahlungsart').selectOption('card')
  await expect(page.getByRole('group', { name: 'Gutschein' })).toBeHidden()
  await expect(voucherField).toBeHidden()
  await expect(voucherTill).toBeHidden()

  await page.getByLabel('Gebuchte Leistung').selectOption('video_photo')
  await page.getByLabel('Gewichtszuschlag').selectOption('over_90')

  // 270 jump + 120 video+photo + 40 surcharge, computed from the price table.
  const total = page.locator('.price-total .numeral')
  await expect(total).toHaveText('430 €')

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
  // local component state. Column order: 0 checkbox, 1 Name, 2 Alter,
  // 3 Gewicht, 4 Tandemmaster, 5 Load-Nr.
  const updatedRow = page.locator('tr.clickable-row', { hasText: fullName })
  await expect(updatedRow).toBeVisible()
  await expect(updatedRow).toContainText('Karte')
  await expect(updatedRow).toContainText('Sprung+Video+Foto')
  await expect(updatedRow).toContainText('ab 90 kg')
  await expect(updatedRow).toContainText('430 €')
  await expect(updatedRow.locator('td').nth(5)).toHaveText('5')

  // --- Collect the money: the row moves from the open table to the paid one ---
  const openTable = page.locator('table.manifest-table-open')
  const paidTable = page.locator('table.manifest-table-paid')
  await expect(openTable.locator('tr.clickable-row', { hasText: fullName })).toBeVisible()

  await updatedRow.getByRole('button', { name: /Kassiert/ }).click()

  await expect(paidTable.locator('tr.clickable-row', { hasText: fullName })).toBeVisible()
  await expect(openTable.locator('tr.clickable-row', { hasText: fullName })).toHaveCount(0)

  // The move survives a reload, so it was stored and not just held in the page.
  await page.reload()
  await expect(paidTable.locator('tr.clickable-row', { hasText: fullName })).toBeVisible()

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

  // Every field the guest typed has to reach the sheet, and the stored enums
  // have to arrive translated rather than as raw values. The sheet leads with
  // 3 meta rows (Datum/Ort/Betriebsleiter) + 1 spacer, so the column header
  // row is row 5 and the first data row is row 6; address is one combined
  // "Straße und Hausnummer, PLZ, Wohnort" column.
  const headers = ws.getRow(5).values as any[]
  const guestRow = ws.getRow(6).values as any[]
  const cell = (header: string) => guestRow[headers.indexOf(header)]

  expect(cell('Geschlecht')).toBe('männlich')
  expect(cell('Adresse')).toBe(`${GUEST.street}, ${GUEST.postalCode}, ${GUEST.city}`)
  expect(cell('Zahlungsart')).toBe('Karte')
  expect(cell('Leistung')).toBe('Sprung+Video+Foto')
  expect(cell('Zuschlag')).toBe('ab 90 kg')
  expect(cell('Preis')).toBe(430)

  // The point of the sheet at the end of a jump day: what was taken in. This
  // guest paid by card, so the whole 430 lands in the card total.
  const totals = new Map<string, unknown>()
  ws.eachRow((r) => {
    const label = r.getCell(1).value
    if (typeof label === 'string' && (label.startsWith('Summe') || label === 'Gesamt')) {
      totals.set(label, r.getCell(2).value)
    }
  })
  expect(totals.get('Summe Karte')).toBe(430)
  expect(totals.get('Summe ohne Zahlungsart')).toBe(0)
  expect(totals.get('Gesamt')).toBe(430)

  // What the club owes its crew, with the arithmetic beside each amount. Nobody
  // was assigned to this jump, so both lines are the "ohne …" reminders — the
  // block must still show them rather than lose the jump.
  const payoutLines: [unknown, unknown, unknown][] = []
  ws.eachRow((r) => payoutLines.push([r.getCell(1).value, r.getCell(2).value, r.getCell(3).value]))
  expect(payoutLines).toContainEqual(['Vergütung Tandemmaster', null, null])
  expect(payoutLines).toContainEqual(['ohne Tandemmaster', '1 × 45,00 €', 45])
  expect(payoutLines).toContainEqual(['Vergütung Videoflieger', null, null])
  expect(payoutLines).toContainEqual(['ohne Kameraflieger', '1 × 80,00 €', 80])
})
