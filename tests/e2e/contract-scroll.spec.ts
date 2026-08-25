import { test, expect } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 1200, height: 800 } })

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
  await page.waitForTimeout(300)
}

test('the page cannot be scrolled past the contract before it is read', async ({ page }) => {
  await toContract(page)

  await page.mouse.move(100, 400) // beside the card, not over the text box
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // A finger drag beside the box must not move the page either.
  await page.touchscreen.tap(100, 400)
  await page.evaluate(() => {
    const target = document.querySelector('.screen')!
    const send = (type: string, clientY: number) => {
      const t = new Touch({ identifier: 1, target, clientX: 100, clientY })
      target.dispatchEvent(
        new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true }),
      )
    }
    send('touchstart', 600)
    send('touchmove', 400)
    send('touchmove', 200)
    send('touchend', 200)
  })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator('.scroll-hint')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeDisabled()
})

test('a wheel carries on into the collapse once the text has been read', async ({ page }) => {
  await toContract(page)
  const box = page.locator('.contract-text')
  const heightAtLoad = await box.evaluate((el) => el.clientHeight)

  await box.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(page.locator('.scroll-hint')).toBeHidden()

  // Wheel over the box, which has nothing left to scroll: the page has to take
  // it, or a mouse can never reach the signature.
  await page.mouse.move(600, 400)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(200)

  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect(await box.evaluate((el) => el.clientHeight)).toBeLessThan(heightAtLoad)
})

test('one finger reads the contract and collapses it without lifting', async ({ page }) => {
  await toContract(page)
  const heightAtLoad = await page.locator('.contract-text').evaluate((el) => el.clientHeight)

  // One gesture: scroll the box to its end, then keep dragging. jsdom-free,
  // real Chromium — the box scrolls natively, the leftover has to reach the page.
  const result = await page.evaluate(async () => {
    const box = document.querySelector('.contract-text') as HTMLElement
    const send = (type: string, clientY: number) => {
      const t = new Touch({ identifier: 1, target: box, clientX: 600, clientY })
      box.dispatchEvent(
        new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true }),
      )
    }
    const frame = () => new Promise((r) => requestAnimationFrame(r))

    send('touchstart', 700)
    // Native touch scrolling of the box is not driven by synthetic events, so
    // the box is put at its end first — the state the real finger arrives in.
    box.scrollTop = box.scrollHeight
    let y = 700
    for (let i = 0; i < 10; i++) {
      y -= 30
      send('touchmove', y)
      await frame()
    }
    send('touchend', y)
    await frame()
    await frame()
    return { scrolledToEndSeen: !document.querySelector('.scroll-hint'), scrollY: window.scrollY }
  })

  console.log('CHAIN', JSON.stringify(result))
  expect(result.scrolledToEndSeen).toBe(true)
  // Ten 30px steps of the same finger, handed to the page without a lift.
  expect(result.scrollY).toBe(300)

  const collapsed = await page.locator('.contract-text').evaluate((el) => el.clientHeight)
  console.log('HEIGHT', heightAtLoad, '->', collapsed)
  expect(collapsed).toBe(heightAtLoad - 300)
})
