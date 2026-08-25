import { test, expect } from '@playwright/test'

// The contract screen has exactly one scroller: the page. These tests hold that
// property, because it is what an earlier nested-scroller version got wrong —
// a drag beside the text box scrolled past the contract, and a gesture that ran
// out inside the box died there instead of carrying on.

test.use({ viewport: { width: 1200, height: 800 } })

async function toContract(page: import('@playwright/test').Page) {
  await page.goto('/guest/')
  await page.getByRole('button', { name: 'Anmeldung starten' }).click()
  await page.getByLabel('Vorname').fill('Max')
  await page.getByLabel('Nachname').fill('Mustermann')
  await page.getByRole('radio', { name: 'männlich' }).check()
  await page.getByLabel('Alter').fill('30')
  await page.getByLabel('Größe (cm)').fill('182')
  await page.getByLabel('Gewicht (kg)').fill('85')
  await page.getByLabel('Straße und Hausnummer').fill('Musterstraße 1')
  await page.getByLabel('PLZ').fill('4240')
  await page.getByLabel('Wohnort').fill('Freistadt')
  await page.getByLabel('E-Mail').fill('max@example.at')
  await page.getByLabel('Telefon').fill('0660123456')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.locator('.contract-text')).toBeVisible()
  await page.waitForTimeout(200)
}

test('the contract fills the screen and nothing inside it scrolls on its own', async ({ page }) => {
  await toContract(page)

  // Arriving from a form left mid-scroll, the guest starts at the top.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  const text = page.locator('.contract-text')
  const geometry = await text.evaluate((el) => ({
    scrollable: el.scrollHeight > el.clientHeight + 1,
    height: el.clientHeight,
    viewport: window.innerHeight,
  }))
  // No inner scroller, and long enough to cover the screen the guest is holding.
  expect(geometry.scrollable).toBe(false)
  expect(geometry.height).toBeGreaterThan(geometry.viewport)

  await expect(page.locator('.scroll-hint')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Anmeldung abschicken' })).toBeDisabled()
})

test('the reading hint stays on screen while there is contract left to read', async ({ page }) => {
  await toContract(page)

  const hint = page.locator('.scroll-hint')
  await expect(hint).toBeInViewport()

  // Half a contract down, the hint is still where the guest can see it.
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(200)
  await expect(hint).toBeInViewport()
})

test('the signature cannot be reached without scrolling through the contract', async ({ page }) => {
  await toContract(page)

  const canvas = page.locator('canvas.signature-pad')
  await expect(canvas).not.toBeInViewport()

  // Everything between the top and the signature is contract: the end marker
  // has to pass through the viewport on the way down.
  const positions = await page.evaluate(() => ({
    end: document.querySelector('.contract-end')!.getBoundingClientRect().top + window.scrollY,
    pad: document.querySelector('canvas.signature-pad')!.getBoundingClientRect().top + window.scrollY,
  }))
  expect(positions.end).toBeLessThan(positions.pad)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  await expect(page.locator('.scroll-hint')).toBeHidden()
  await expect(canvas).toBeInViewport()
})

test('one wheel gesture runs from the contract into the signature without a seam', async ({ page }) => {
  await toContract(page)

  // Nothing in the page's path may swallow the scroll: every step of the same
  // gesture has to move the page by itself.
  await page.mouse.move(600, 400)
  const travelled: number[] = []
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(80)
    travelled.push(await page.evaluate(() => window.scrollY))
  }

  for (let i = 1; i < travelled.length; i++) {
    expect(travelled[i]).toBeGreaterThan(travelled[i - 1])
  }
})
