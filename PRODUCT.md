# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, each with its own app:

- **Guests** (`web/guest`): tandem passengers, often first-time jumpers, who register themselves before their jump. They use a club Android tablet in kiosk mode (installed as a PWA, no address bar, on-screen keyboard, held in the hand). Their job: enter personal data, read and sign the transport contract (Beförderungsvertrag), and hand back to staff.
- **Operators** (`web/manifest`): the club staff who run a jump day.
  - **Manifest staff** at the manifest desk: check incoming registrations, verify vouchers, assign tandem master and camera flyer, collect payment, print the signed contract and the Urkunde.
  - **Betriebsleiter**: runs the day, is recorded per day, and does the Tagesabschluss and export.
  - **Tandem masters**: look at the list and their payouts, possibly from another device on the club WLAN.

## Product Purpose

Replace the paper contract and hand-kept tandem list for a jump day. A guest signs on the tablet, the signature is drawn into the club's real PDF contract, and the registration appears live in the manifest. Staff move it from open to collected (cash or card), and at the end of the day the Tagesabschluss writes the Excel list and payouts for tandem masters and camera flyers to the club's export folder.

Success means: no paper forms to type up, no guest leaves unpaid or with an unredeemed voucher missed, and the day's numbers match the money in the till without manual adding up.

## Positioning

It is built around how a small club drop zone really works: the club's own contract PDF, its own voucher Excel file (`Tandemliste.xlsx`, read for validation and written only in the "Eingelöst" column), its own prices per jump day, and its own payout rates. Payment happens after landing, so "open" versus "collected" is its own state and not taken from the payment method. It runs offline on the club's LAN as one Windows exe, with no cloud account.

## Operating Context

- Airfield, jump days. The server runs on the manifest's Windows PC (`tandem.exe` plus `better_sqlite3.node`). The guest tablet and other devices reach it over the club WLAN (Bonjour discovery, optional hidden `apiBase` setting on the tablet).
- The guest tablet is a kiosk. A hidden settings screen opens after five taps on the logo. The done screen returns to welcome by itself.
- The manifest shows open registrations separately from collected ones, updates live through SSE, and supports picking several rows to collect payment or delete in one go.
- Documents: the filled contract PDF per registration, the Urkunde PDF (guest name and jump date), the Excel day export to a OneDrive folder (`exportDir`), and the club's voucher list.
- Updates come from GitHub releases and install from within the manifest. Only the machine running the server may shut it down.
- Busy days: operators work fast and get interrupted, often near open hangar doors or outside.

## Capabilities and Constraints

- Guest flow: welcome → form (gender, height, weight, split address, contact, voucher number) → contract and signature on one screen → done.
- Manifest views: Übersicht, Manifest list and detail, Tarife (prices, payout rates, price table per combination), Crew (tandem masters, camera flyers with optional email), Einstellungen, Update.
- Prices can differ per jump day. Extra charges for weight over 90 and 100 kg, video, and video plus photo. Payouts per jump for masters and flyers.
- Voucher check against the club Excel list: a payment date means valid, empty means unpaid, and any other text (for example `STORNO`) means invalid and is shown word for word.
- Export warns about tandems still open. The Betriebsleiter must be set before the Tagesabschluss.
- Single-file Windows deployment, SQLite in WAL mode, no login on the manifest (anyone on the club WLAN can open it).
- Language: the UI is German and guests are addressed with "du". Code, comments, logs and commits are English (see CLAUDE.md).
- Freistadt first, others later: built for HFSC Freistadt now, but other clubs may use it later. Club-specific details (name, logo, contract text, jump location, prices) should stay configurable or easy to swap, not hard-wired further. Some are hard-coded today (for example the welcome text "HFSC Freistadt").
- Not decided: sending camera flyers the guest contacts by email (only the address is stored so far), and how the product would be offered to other clubs.

## Brand Commitments

- Club: HFSC Skydive Freistadt. Logo: `icon.png` (also used as favicon, PWA icons, and on the welcome and done screens through `BrandMark`).
- The contract text and layout come from the club's real `assets/Befoerderungsvertrag.pdf`. The Urkunde comes from `assets/Urkunde.pdf`. PDF text uses the shipped DejaVu Sans Condensed fonts.
- Guest-facing voice: friendly German "du" ("Bitte melde dich hier für deinen Tandemsprung an."). Operator-facing text uses plain German terms of the trade (Manifest, Tagesabschluss, Kassieren, Betriebsleiter, Gutschein).

## Evidence on Hand

- Real club documents: `assets/Befoerderungsvertrag.pdf`, `assets/Urkunde.pdf`, and a sample voucher list (`Beispiel Tandemliste.xlsx`, gitignored, local only).
- Design and implementation history: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- No testimonials, usage numbers, or other clubs using it exist. Do not invent any.

## Product Principles

1. **The paper trail stays real.** Whatever the app produces (contract, Urkunde, Excel list, voucher redemption) must match the club's own documents and files, never a parallel invented format.
2. **Money state is explicit.** Open, collected, cash, card, voucher, and payouts are always visible and never inferred, so the day closes without surprises.
3. **Built for interruption.** Operators act fast and get pulled away. Every action shows clearly what it affects (one day, or only the selected rows), and mistakes are easy to spot before they are written out.
4. **The guest only has to do their part.** One task per screen, big targets, the right keyboard per field, nothing on screen that is meant for staff.
5. **The club's identity can be swapped.** HFSC Freistadt comes first, but nothing should block a second club later.

## Accessibility & Inclusion

- Readable in bright light: the tablet and the manifest PC are often used outside or near open hangar doors, so contrast must hold up in sunlight.
- Guest tablet: big tap targets (gloved fingers come up in the code), no pinch zoom, a suitable on-screen keyboard and action key per field, field-to-field navigation without a Tab key, and the layout stays usable while the Android keyboard covers the lower half.
- Operators: under time pressure, so state and scope must be readable at a glance, and destructive or money actions need a clear confirmation or undo.
