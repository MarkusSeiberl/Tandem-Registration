import fs from 'fs'
import path from 'path'

// Every amount the club charges, in EUR. Kept in config.json (and editable from
// the manifest settings screen) because the club raises prices between seasons.
export interface Prices {
  jump: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}

export const PRICE_KEYS = [
  'jump', 'video', 'video_photo', 'weight_over_90', 'weight_over_100',
] as const

export const DEFAULT_PRICES: Prices = {
  jump: 270,
  video: 100,
  video_photo: 120,
  weight_over_90: 40,
  weight_over_100: 60,
}

// What the club pays out per jump, in EUR. Separate from `Prices` because these
// amounts never touch what a guest owes — they are the club's side of the day.
export interface Payouts {
  tandem_master: number
  video: number
  video_photo: number
}

export const PAYOUT_KEYS = ['tandem_master', 'video', 'video_photo'] as const

export const DEFAULT_PAYOUTS: Payouts = {
  tandem_master: 45,
  video: 60,
  video_photo: 80,
}

export interface Config {
  exportDir: string
  contractText: string
  jumpLocation: string
  backupDir: string
  prices: Prices
  payouts: Payouts
}

const CONTRACT_TEXT = `Der Tandempassagier erklärt seinen Beitritt beim HFSC-Freistadt als unterstützendes Mitglied. Mit dieser Mitgliedschaft sind keine finanziellen Verpflichtungen verbunden. Die Mitgliedschaft endet automatisch mit Ende des Jahres der Unterfertigung. Bei allen Beförderungen von Personen und Sachen mit dem vom HFSC-Freistadt gehaltenen und betriebenen Tandemfallschirmen fungiert ausschließlich der HFSC-Freistadt als Beförderer und ist damit Vertragspartner des oben namentlich angeführten Tandempassagiers. Die Durchführung von Tandemfallschirmsprüngen erfolgt nicht gewerblich, sondern nur im Rahmen der Mitgliederwerbung und zur Popularisierung des Fallschirmsports. Ein allenfalls für die Beförderung vereinbarter Kosten(Mitglieds-)beitrag fließt ungekürzt und unmittelbar dem gemeinnützigen HFSC-Freistadt zu, der damit alleiniger Vertragspartner des Tandempassagiers im Beförderungsvertrag ist. Der jeweilige Tandemmaster bzw. die Person, welche die Vereinbarungen im Zusammenhang mit der Beförderung mit dem Tandempassagier trifft, handelt als Vertreter des HFSC-Freistadt und damit nicht im eigenen Namen.

Zugunsten eines jeden Tandempassagiers (und der mit ihm beförderten Sachen) ist eine gesetzlich vorgeschriebene Haftpflichtversicherung vom Halter der Tandemfallschirme abgeschlossen worden.

Der Tandempassagier verzichtet im Falle eines Schadensereignisses ausdrücklich auf die Geltendmachung von Ansprüchen (z. B. Schadenersatz, Schmerzengeld, Verdienstentgang, Rente etc.) gegenüber dem Tandempiloten und auch gegenüber dem Piloten des Absetzluftfahrzeugs, ausgenommen dem Tandemmaster kann grobe Fahrlässigkeit oder Vorsatz nachgewiesen werden. Die Haftung des Beförderers für die mitbeförderten Sachen des Tandempassagiers beschränkt sich auf die Höhe der dafür abgeschlossenen Versicherung. Darüberhinausgehende Ansprüche können nur bei Vorsatz oder grober Fahrlässigkeit geltend gemacht werden.

Der Tandempassagier ist verpflichtet, den Tandemmaster (im Folgenden kurz TM) darauf hinzuweisen, wenn er:
1) innerhalb der letzten 12 Monate einen schweren Unfall hatte (Knochenbruch, Bänderriss, Gehirnerschütterung oder ähnliches);
2) innerhalb der letzten 12 Monate wegen einer ernsthaften Erkrankung (Herz, Wirbelsäule, Bandscheiben, Bluthochdruck, Organleiden oder ähnlichem) in ärztlicher Behandlung war oder ist;
3) innerhalb der letzten 12 Monate an seelischen oder psychischen Defekten (Drogensucht, Bewusstseinsstörungen oder ähnlichen) gelitten hat oder daran noch leidet;
4) in den letzten 12 Stunden Alkohol zu sich genommen hat.

Der Tandempassagier erklärt hiermit, Nachstehendes zur Kenntnis genommen zu haben und sich entsprechend zu verhalten:

1) Verhalten am Flugplatz:
Immer von hinten zum Flugzeug gehen, nie direkt auf den Propeller zu!
Immer den Anweisungen des TM Folge leisten! Bei Unklarheiten bitte den TM fragen!

2) Einweisung in den Sprungablauf:
Absprung: Hohlkreuz mit Becken nach vorne und somit Körper wie eine Banane halten, Kopf in den Nacken, mit den Händen an den Hosenträger-Gurte greifen und festhalten, nicht am Flugzeug festhalten
Freier Fall: Hohlkreuz, durch die Nase atmen, Mund geschlossen halten, nichts mit den Händen angreifen
Offener Schirm: Anweisungen des TM befolgen, nichts angreifen außer auf ausdrückliche Anweisung des TM
Unmittelbar vor der Landung (Landehaltung): beide Oberschenkel samt Knie 90° anheben, wenn notwendig durch Griff in beide Kniekehlen unterstützen; zusätzlich Unterschenkel mind. 45° nach vorne anheben; Anweisungen des TM befolgen.
Als Passagier bin ich in der Lage, die oben genannte Landehaltung für mindestens eine Minute zu halten.

3) In Notsituationen den Anweisungen des Tandemmaster unbedingt und sofort Folge leisten.
4) Es besteht kein Versicherungsschutz für Brillen, Kontaktlinsen, Schmuck, Uhren und ähnliches bei Beschädigung oder Verlust.
5) Trotz gewissenhafter Sprungvorbereitung bestehen gesundheitliche Risiken auf Grund rascher Druckänderung im Freifall, unplanmäßiger Landung, Störungen am Fallschirm, etc.

Obwohl ein Tandemfallschirmsprung im allgemeinen eine harmlose und ungefährliche Angelegenheit ist, wurde ich dennoch über die eventuellen Unfallgefahren des von mir beabsichtigten Tandemfallschirmsprunges informiert, insbesondere darüber, dass auch bei größter Sorgfalt und optimalen Flugverlauf bei der Öffnung und der Landung durch unplanmäßige Öffnungen, unrichtiges Aufkommen, Auftreten oder Stürze, Unfälle mit nicht unerheblichen Verletzungsfolgen (z. B. Verstauchungen, Knochenbruch, Halswirbelsäulenprellung, Wirbelverletzungen, Gehirnerschütterungen u. v. m.) passieren können. Dieses allgemeine Verletzungsrisiko in der Schirmöffnungs-, Schirmflug und Landephase kann sich durch windbedingten Einfluss, welcher zu einem unruhigen Flugverlauf und dadurch zu einer harten Öffnung und/oder Landung führen kann, erhöhen. Schließlich ist mir bewusst, dass das Extrem-Risiko darin besteht, dass sich der Hauptfallschirm nicht öffnet und der für diesen Fall vorgesehene Reservefallschirm ebenfalls versagt.

Alle Film- und Fotorechte verbleiben beim HFSC-Freistadt. Ich bin damit einverstanden, per E-Mail durch den HFSC-Freistadt zur Übermittlung von Angeboten und Aktionen über das Fallschirmspringen kontaktiert zu werden. Ich bin damit einverstanden, dass meine umseitigen persönlichen Daten automatisationsunterstützt gespeichert und verwaltet werden.

Es ist vereinbart, dass jede Beförderung am Fallschirm und in der Absetzmaschine nach österreichischem Recht erfolgt. Vereinbart wird zudem ausdrücklich der Gerichtsstand Linz.

Ich bestätige, dass ich den obigen Text genau gelesen habe und ich nur dann in das Flugzeug einsteigen werde, wenn ich eine umfassende Einweisung durch den TM erhalten habe und alle mit meinem Tandemfallschirmsprung in Zusammenhang stehenden Fragen zufriedenstellend beantwortet wurden.

Ich bestätige durch den TM eine umfassende Einweisung für den Tandem-Passagier-Fallschirmsprung erhalten zu haben und über das richtige Verhalten informiert worden zu sein. Insbesondere bestätige ich, dass die Absprunghaltung, die Freifallhaltung und die Landehaltung durch den TM vorgezeigt und von mir am Boden nachvollzogen wurden und keine Fragen dazu mehr bestehen.`

export function loadConfig(dir: string): Config {
  const p = path.join(dir, 'config.json')
  const def: Config = {
    exportDir: dir, contractText: CONTRACT_TEXT, jumpLocation: '', backupDir: '',
    prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
  }
  try {
    const stored = JSON.parse(fs.readFileSync(p, 'utf8'))
    // `prices` and `payouts` are merged per key, not replaced: a config.json
    // written before either block existed has no block at all, and one written by
    // an older version could be missing a single amount. Either way every key must
    // end up with a number.
    return {
      ...def, ...stored,
      prices: { ...DEFAULT_PRICES, ...(stored?.prices ?? {}) },
      payouts: { ...DEFAULT_PAYOUTS, ...(stored?.payouts ?? {}) },
    }
  } catch {
    return def
  }
}

export function saveConfig(dir: string, cfg: Config) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2))
}
