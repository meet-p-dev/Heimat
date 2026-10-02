/* The category for what you're typing, before you pick one (iOS: Suggest.swift — the
   same rules; tests/suggest-vectors.json holds both to the same answers).

   Precedence, most specific first — as in MoneyTrack (lib/merchants.js there):
     what you chose before for this exact name  >  for its first word  >  shops and words
   so a wrong guess is one correction away from never coming back.

   The shop list is MoneyTrack's merchant prior, sorted into Splitlife's categories, plus
   the words people type into a shared bill ("Miete", "Strom", "Döner", "Putzmittel").
   PRIVACY: only organisations and everyday words — never a person's name. */

export interface Learned { description: string; category: string }

type Rule = [RegExp, string, boolean?]
const AMBIGUOUS = true
// a receipt marker, a legal-entity suffix, or the name standing alone: a shop, not a person
const RETAIL = /(sagt danke|danke|markt|filiale|gmbh|\bag\b|\bse\b|\bkg\b|discount|supermarkt|drogerie|tankstelle|store|shop)/i

// \b doesn't know umlauts; (?<![\p{L}]) … (?![\p{L}]) does
const W = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu')

export const RULES: Rule[] = [
  // rent first: "Miete Strom" is the rent
  [W('miete|kaltmiete|warmmiete|rent|nebenkosten|betriebskosten|hausverwaltung|kaution|mietkaution|vonovia|deutsche wohnen'), 'rent'],
  // ── utilities ──
  [W('strom|electricity|gas|heizung|heating|wasser|water bill|rundfunk|rundfunkbeitrag|gez|beitragsservice|stadtwerke|vattenfall|e\\.?on|enbw|rwe|gasag|lichtblick|naturstrom|yello|eprimo|octopus energy'), 'utilities'],
  // ── internet & phone ──
  [W('internet|wlan|wifi|wi-fi|router|dsl|glasfaser|telekom|vodafone|o2|congstar|1&1|1und1|pyur|unitymedia|freenet|drillisch|aldi talk|lebara|lycamobile|simyo|winsim'), 'internet'],
  // ── groceries ──
  [W('rewe|edeka|aldi|lidl|netto|kaufland|globus|tegut|denns|alnatura|marktkauf|famila|nahkauf|trinkgut|wasgau|feneberg|bio ?company|basic bio|metro|getr[aä]nkemarkt|frischemarkt|asia ?markt|türkischer markt|tuerkischer markt'), 'groceries'],
  [W('norma|penny'), 'groceries', AMBIGUOUS],
  [W('groceries|grocery|supermarket|supermarkt|einkauf|einkaufen|wocheneinkauf|lebensmittel|milch|milk|brot|bread|eier|eggs|obst|gemüse|gemuese|fruit|vegetables|getränke|getraenke|drinks for home|wasserkisten?|pfand'), 'groceries'],
  // ── eating out ──
  [W('mcdonald\'?s?|burger king|kfc|subway|starbucks|vapiano|nordsee|backwerk|five guys|hans im gl[uü]ck|l\'?osteria|dean ?& ?david|lieferando|uber ?eats|wolt|deliveroo|foodora|too good to go'), 'eatout'],
  [W('restaurant|dinner|lunch|breakfast|brunch|pizza|döner|doener|kebab|burger|sushi|ramen|curry|imbiss|bistro|café|cafe|coffee|kaffee|bakery|bäcker|baecker|mensa|kantine|takeaway|take-away|delivery|bar|bier|beer|cocktails?|drinks|essen gehen|eating out'), 'eatout'],
  // ── transport ──
  [W('deutsche bahn|db|bahn|bvg|mvg|hvv|rmv|vgn|vrr|vbb|flixbus|flixtrain|blablacar|uber|free ?now|taxi|bus|train|zug|s-?bahn|u-?bahn|tram|deutschlandticket|d-?ticket|fahrkarte|monatskarte|semesterticket|flight|flug|ryanair|lufthansa|easyjet|eurowings|sixt|europcar|share ?now|lime|voi|nextbike|swapfiets|benzin|diesel|tanken|fuel|petrol|aral|shell|esso|parken|parking|parkhaus'), 'transport'],
  [W('bolt|tier'), 'transport', AMBIGUOUS],
  // ── household ──
  [W('ikea|obi|bauhaus|hornbach|toom|action|depot|tedi|kik|rossmann|dm|budni|müller drogerie|drogerie|putzmittel|cleaning|reiniger|spülmittel|spuelmittel|dish soap|detergent|waschmittel|laundry|klopapier|toilettenpapier|toilet paper|küchenrolle|kuechenrolle|paper towels?|müllbeutel|muellbeutel|trash bags?|bin bags?|schwamm|sponges?|glühbirne|gluehbirne|light ?bulbs?|batterien|batteries|möbel|moebel|furniture|staubsauger|vacuum|pfanne|teller|plates'), 'household'],
]

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}& ]+/gu, ' ').replace(/\s+/g, ' ').trim()

/* the built-in guess for a description, or null when nothing is confident */
export function builtinCategory(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const looksRetail = t.split(/\s+/).length === 1 || RETAIL.test(t)
  for (const [re, cat, ambiguous] of RULES) {
    if (!re.test(t)) continue
    if (ambiguous && !looksRetail) continue
    return cat
  }
  return null
}

/* what you chose before: the latest choice for the whole name, and for its first word */
export function learn(history: Learned[]): { exact: Map<string, string>; first: Map<string, string> } {
  const exact = new Map<string, string>(), first = new Map<string, string>()
  // history arrives newest first; the first seen wins
  for (const h of history) {
    const n = norm(h.description)
    if (!n || !h.category) continue
    if (!exact.has(n)) exact.set(n, h.category)
    const w = n.split(' ')[0]
    if (w.length >= 4 && !first.has(w)) first.set(w, h.category)
  }
  return { exact, first }
}

export function suggestCategory(text: string, learned: ReturnType<typeof learn>, known: (id: string) => boolean = () => true): string | null {
  const n = norm(text)
  if (n.length < 3) return null
  const pick = (c: string | null | undefined) => (c && known(c) ? c : null)
  return pick(learned.exact.get(n)) || pick(learned.first.get(n.split(' ')[0])) || pick(builtinCategory(text))
}
