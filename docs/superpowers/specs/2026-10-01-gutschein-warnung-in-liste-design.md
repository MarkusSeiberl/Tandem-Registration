# Gutschein-Warnung in der Manifest-Liste

Datum: 2026-10-01

## Problem

Seit der [Gutschein-Nr. bei der Registrierung](2026-09-03-gutschein-nr-bei-registrierung-design.md)
kommt eine Zeile oft schon mit Nummer ins Manifest. Das Urteil der
[Gutscheinprüfung](2026-08-10-gutscheinpruefung-design.md) sieht der Betreiber
aber erst, wenn er die Zeile öffnet. Ein unbezahlter, eingelöster oder
unbekannter Gutschein soll schon in der Liste auffallen.

## Was der Betreiber sieht

Ein `⚠` vor dem Namen, in beiden Tabellen (Offen und Kassiert). Der Grund steht
als Tooltip (`title`) und als `aria-label` daran, wortgleich mit der
Statuszeile der Detailansicht:

| Status | Tooltip |
| ------ | ------- |
| `unpaid` | Nicht bezahlt — Gutschein ist nicht gültig. |
| `cancelled` | Storniert („STORNO"). |
| `redeemed` | Bereits eingelöst am 12.07.2026. |
| `not_found` | Nummer nicht in der Gutscheinliste. |
| `ambiguous` | Mehrere Gutscheine passen zu dieser Nummer. |

`ok`, keine Nummer, keine konfigurierte Liste oder eine unlesbare Liste: kein
Zeichen. Nichts davon blockiert Speichern oder Kassieren.

## Gespeichertes Urteil

Zwei neue Spalten auf `registrations`:

- `voucher_check_status` — einer der fünf Warnstatus oben, sonst `NULL`.
- `voucher_check_detail` — Einlösedatum (`YYYY-MM-DD`) bei `redeemed`, der Text
  aus `EinzahlDat` bei `cancelled`, sonst `NULL`.

Gespeichert wird, weil eine Live-Prüfung nach unserer eigenen Einlösung
`redeemed` meldet: Sobald der Export das Datum in die Liste geschrieben hat,
würde jede kassierte Gutschein-Zeile ihr eigenes ⚠ bekommen.

## Wann geprüft wird

**`GET /api/registrations`** liest die Liste einmal (Cache aus
`loadVoucherList`) und prüft jede Zeile, die

- eine `voucher_number` hat,
- noch nicht kassiert ist (`paid_at IS NULL`) und
- deren Einlösung noch nicht in der Datei steht (`voucher_redeem_synced_at IS NULL`
  — eine wieder geöffnete, schon geschriebene Zeile fände sonst ihr eigenes Datum).

Weicht das Ergebnis vom gespeicherten ab, wird es geschrieben. Damit erscheint
das ⚠ sofort, wenn eine neue Registrierung per SSE die Liste neu laden lässt,
und verschwindet von selbst, wenn der Verein den Gutschein mitten am Tag als
bezahlt einträgt.

**`PATCH /api/registrations/:id`** prüft neu, wenn sich `voucher_number`
ändert oder die Zeile kassiert wird. Eine geleerte Nummer setzt beide Spalten
auf `NULL`. Der Moment des Kassierens hält so das Urteil fest, unter dem
kassiert wurde. Best-effort: ein Fehler hier bricht das Speichern nicht ab.

Kassierte Zeilen behalten ihr Urteil danach, es wird nicht mehr live geprüft.

**Liste unlesbar:** das gespeicherte Urteil bleibt unverändert, es wird nichts
gelöscht. **Liste nicht konfiguriert:** `GET` liefert beide Spalten als `NULL`,
damit ein abgeschaltetes Feature keine Warnungen von früher zeigt.

## Tests

- Server: `GET` setzt `voucher_check_status` für unbezahlt, eingelöst, unbekannt;
  `ok` bleibt `NULL`; eine Zahlung in der Liste löscht das Urteil beim nächsten
  `GET`; kassierte Zeilen werden nicht neu geprüft; ohne Liste kommt `NULL`
  zurück; `PATCH` mit neuer Nummer prüft neu, mit geleerter Nummer leert es.
- Manifest: `List` zeigt `⚠` mit Tooltip-Text bei gesetztem Status, nichts ohne.
