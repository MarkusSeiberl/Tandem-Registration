# Preise, Gewichtszuschlag und Gutschein-Zusatzbuchungen

Datum: 2026-07-28

## Problem

1. Gäste über 90 kg / 100 kg zahlen einen Aufpreis. Das Manifest muss den Zuschlag
   selbst setzen können — nicht aus dem eingetragenen Gewicht abgeleitet, weil das
   Manifest Ausnahmen macht.
2. Gäste mit Gutschein können aktuell nichts dazubuchen. Ein Gutschein steht für
   eine Leistung (Sprung / Sprung+Video / Sprung+Video+Foto), nicht für einen Betrag.
3. Die Preise stehen nirgends. Am Tagesende soll aus dem Excel-Export hervorgehen,
   wie viel Geld eingenommen wurde.

## Geldmodell

Gezählt wird nur, was **an diesem Tag kassiert** wurde. Ein Gutschein wurde früher
bezahlt und taucht mit 0 € auf; nur die Zuzahlung des Gutschein-Gastes zählt.

```
leistung  = prices.jump
          + (extra_booking: video → prices.video, video_photo → prices.video_photo, sonst 0)
gutschein = payment_method === 'voucher'
            ? min(wert(voucher_service), leistung)
            : 0
surcharge = weight_surcharge: over_90 → prices.weight_over_90,
                              over_100 → prices.weight_over_100, sonst 0
price     = leistung − gutschein + surcharge
```

`extra_booking` ist die **Gesamtleistung, die der Gast bekommt** (Feld „Gebuchte
Leistung"), nicht ein Aufschlag auf den Gutschein. Der Gutschein wird zum heutigen
Listenpreis davon abgezogen:

| Gutschein-Leistung | Gebuchte Leistung | Zu kassieren |
| ------------------ | ----------------- | ------------ |
| Sprung             | nur Sprung        | 0 €          |
| Sprung             | Sprung+Video      | 100 €        |
| Sprung+Video       | Sprung+Video+Foto | 20 €         |

Ein Gutschein, der mehr wert ist als die geflogene Leistung, wird nicht in bar
ausbezahlt — der Abzug ist auf die Leistung gedeckelt. Damit summieren sich die
Zeilen der Aufschlüsselung immer exakt auf den Gesamtbetrag. Die Auswahl einer
Gutschein-Leistung hebt die gebuchte Leistung mindestens auf dieses Niveau an, damit
der Gast nie unter dem einlöst, was der Gutschein bereits abdeckt.

Der Gewichtszuschlag ist von keinem Gutschein gedeckt und kommt immer obendrauf.

Ein Gutschein selbst bewegt heute kein Geld. Die **Zuzahlung** wird aber bar oder
mit Karte kassiert und muss abends in der jeweiligen Kassa auftauchen — dafür gibt
es `voucher_payment_method` (Bar/Karte), sichtbar nur, wenn tatsächlich etwas zu
kassieren ist.

Ein noch nicht gesetztes `payment_method` (NULL) zählt als "kein Gutschein", eine
frische Registrierung zeigt also den vollen Sprungpreis.

## Konfiguration

`Config` bekommt einen `prices`-Block mit den Vorgaben 270 / 100 / 120 / 40 / 60:

```ts
prices: {
  jump: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}
```

`loadConfig` mischt die Vorgaben pro Schlüssel ein, damit eine bestehende
config.json ohne `prices` alle fünf Werte erhält. `PUT /api/settings` prüft jeden
Wert als endliche Zahl ≥ 0 und mischt `prices` verschachtelt — ein flacher Spread
würde nicht gesendete Schlüssel löschen.

## Datenbank

Drei neue Spalten auf `registrations`, nachgezogen in `migrate()`:

| Spalte                   | Werte                                             |
| ------------------------ | ------------------------------------------------- |
| `voucher_service`        | `jump` \| `jump_video` \| `jump_video_photo` \| NULL |
| `weight_surcharge`       | `none` \| `over_90` \| `over_100`                 |
| `price_override`         | 0/1                                               |
| `voucher_payment_method` | `cash` \| `card` \| NULL                          |

## Server

Neue `src/server/pricing.ts` mit der Preisregel. `PATCH /api/registrations/:id`
berechnet `price` neu, sobald `payment_method`, `voucher_service`, `extra_booking`
oder `weight_surcharge` im Body stehen und `price_override` 0 ist. Enthält der Body
`price`, wird `price_override` auf 1 gesetzt und die Zahl unverändert gespeichert;
`price_override: 0` erzwingt eine Neuberechnung.

## Manifest

- Zahlungsart „Gutschein" zeigt zusätzlich zur Gutschein-Nr. eine Auswahl
  **Gutschein-Leistung**.
- **Zusatzbuchung** heißt jetzt **Gebuchte Leistung**, mit den gleichen Bezeichnungen
  wie die Gutschein-Leistung (nur Sprung / Sprung+Video / Sprung+Video+Foto), damit
  der Abzug direkt ablesbar ist. Die Excel-Spalte heißt entsprechend „Leistung".
- Neue Auswahl **Gewichtszuschlag** (kein / +90 kg / +100 kg) mit den Beträgen aus
  den Einstellungen. Das eingetragene Gewicht steht daneben als Hinweis, ohne Kopplung.
- Kameraflieger wird sichtbar, wenn `extra_booking` **oder** `voucher_service` Video
  enthält. Bisher blieb das Feld bei einem Gutschein-mit-Video-Gast verborgen.
- Preis ist berechnet und schreibgeschützt, mit Aufschlüsselung inklusive der
  Gutschein-Abzugszeile. Ein Häkchen „abweichender Preis" gibt das Eingabefeld frei.
- Bei Gutschein mit offener Zuzahlung erscheint **Zuzahlung bezahlt mit** (Bar/Karte).
  Sinkt der Betrag auf 0, wird das Feld ausgeblendet und der Wert gelöscht.
- Liste: nur die geflogene Leistung und der Zuschlag als Pills — die
  Gutschein-Leistung steckt bereits in der geflogenen Leistung und würde sonst
  „Sprung+Video" neben „Sprung+Video+Foto" für einen einzigen Sprung anzeigen.
  In der Spalte Zahlungsart steht bei Gutschein zusätzlich die Kassa der Zuzahlung.
  Neue Spalte Preis.
- Einstellungen: Abschnitt „Preise (EUR)" mit fünf Zahlenfeldern.

## Excel

Neue Spalten Zuzahlung mit, Gutschein-Leistung und Zuschlag, „Zusatz" heißt jetzt
„Leistung". Nach den Zeilen ein Summenblock, gruppiert nach der Kassa, in der das
Geld gelandet ist (eine Gutschein-Zuzahlung zählt dort mit, wo sie kassiert wurde):

```
Summe Bar                  410
Summe Karte                100
Summe ohne Zahlungsart       0
Gesamt                     510
davon Gutschein-Zuzahlung  100
```

Bar + Karte + „ohne Zahlungsart" ergeben immer den Gesamtbetrag. Ein Wert über 0
in „ohne Zahlungsart" heißt: bei einer Zeile fehlt die Zahlungsart, die Kassa geht
sich nicht aus. „davon Gutschein-Zuzahlung" ist eine reine Merkzeile — sie ist oben
bereits enthalten.

Preis-Spalte und Summen als echte Zahlen mit Format `#,##0.00 "€"`.

## Tests

Neu: `tests/pricing.test.ts`. Erweitert: `db.test.ts` (Migration),
`manifest-update.test.ts` (Neuberechnung, Override, neue Enums),
`excel.test.ts` / `export.test.ts` (Spalten, Summenblock), `settings.test.ts`
(Preisvalidierung, verschachteltes Mischen) sowie Komponententests im Manifest.
