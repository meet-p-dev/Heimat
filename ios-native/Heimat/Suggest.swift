import Foundation

/// The category for what you're typing, before you pick one — the same rules as
/// src/lib/suggest.ts (tests/suggest-vectors.json holds both to the same answers).
/// What you chose before for this exact name, then for its first word, then shops and
/// everyday words. Only organisations and words, never a person's name.
enum Suggest {
    /// (pattern, category, ambiguous): an ambiguous brand (Penny, Bolt) only counts
    /// when the text reads like a shop rather than a person
    static let rules: [(String, String, Bool)] = [
        ("miete|kaltmiete|warmmiete|rent|nebenkosten|betriebskosten|hausverwaltung|kaution|mietkaution|vonovia|deutsche wohnen", "rent", false),
        ("strom|electricity|gas|heizung|heating|wasser|water bill|rundfunk|rundfunkbeitrag|gez|beitragsservice|stadtwerke|vattenfall|e\\.?on|enbw|rwe|gasag|lichtblick|naturstrom|yello|eprimo|octopus energy", "utilities", false),
        ("internet|wlan|wifi|wi-fi|router|dsl|glasfaser|telekom|vodafone|o2|congstar|1&1|1und1|pyur|unitymedia|freenet|drillisch|aldi talk|lebara|lycamobile|simyo|winsim", "internet", false),
        ("rewe|edeka|aldi|lidl|netto|kaufland|globus|tegut|denns|alnatura|marktkauf|famila|nahkauf|trinkgut|wasgau|feneberg|bio ?company|basic bio|metro|getr[aä]nkemarkt|frischemarkt|asia ?markt|türkischer markt|tuerkischer markt", "groceries", false),
        ("norma|penny", "groceries", true),
        ("groceries|grocery|supermarket|supermarkt|einkauf|einkaufen|wocheneinkauf|lebensmittel|milch|milk|brot|bread|eier|eggs|obst|gemüse|gemuese|fruit|vegetables|getränke|getraenke|drinks for home|wasserkisten?|pfand", "groceries", false),
        ("mcdonald'?s?|burger king|kfc|subway|starbucks|vapiano|nordsee|backwerk|five guys|hans im gl[uü]ck|l'?osteria|dean ?& ?david|lieferando|uber ?eats|wolt|deliveroo|foodora|too good to go", "eatout", false),
        ("restaurant|dinner|lunch|breakfast|brunch|pizza|döner|doener|kebab|burger|sushi|ramen|curry|imbiss|bistro|café|cafe|coffee|kaffee|bakery|bäcker|baecker|mensa|kantine|takeaway|take-away|delivery|bar|bier|beer|cocktails?|drinks|essen gehen|eating out", "eatout", false),
        ("deutsche bahn|db|bahn|bvg|mvg|hvv|rmv|vgn|vrr|vbb|flixbus|flixtrain|blablacar|uber|free ?now|taxi|bus|train|zug|s-?bahn|u-?bahn|tram|deutschlandticket|d-?ticket|fahrkarte|monatskarte|semesterticket|flight|flug|ryanair|lufthansa|easyjet|eurowings|sixt|europcar|share ?now|lime|voi|nextbike|swapfiets|benzin|diesel|tanken|fuel|petrol|aral|shell|esso|parken|parking|parkhaus", "transport", false),
        ("bolt|tier", "transport", true),
        ("ikea|obi|bauhaus|hornbach|toom|action|depot|tedi|kik|rossmann|dm|budni|müller drogerie|drogerie|putzmittel|cleaning|reiniger|spülmittel|spuelmittel|dish soap|detergent|waschmittel|laundry|klopapier|toilettenpapier|toilet paper|küchenrolle|kuechenrolle|paper towels?|müllbeutel|muellbeutel|trash bags?|bin bags?|schwamm|sponges?|glühbirne|gluehbirne|light ?bulbs?|batterien|batteries|möbel|moebel|furniture|staubsauger|vacuum|pfanne|teller|plates", "household", false),
    ]
    private static let compiled: [(NSRegularExpression, String, Bool)] = rules.compactMap { body, cat, amb in
        (try? NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}])(?:" + body + ")(?![\\p{L}\\p{N}])", options: [.caseInsensitive]))
            .map { ($0, cat, amb) }
    }
    private static let retail = try! NSRegularExpression(pattern: "(sagt danke|danke|markt|filiale|gmbh|\\bag\\b|\\bse\\b|\\bkg\\b|discount|supermarkt|drogerie|tankstelle|store|shop)", options: [.caseInsensitive])

    private static func has(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    static func norm(_ s: String) -> String {
        let lowered = s.lowercased().precomposedStringWithCanonicalMapping
        let kept = lowered.unicodeScalars.map { CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0) || $0 == "&" || $0 == " " ? Character($0) : " " }
        return String(kept).split(separator: " ").joined(separator: " ")
    }

    /// the built-in guess, or nil when nothing is confident
    static func builtin(_ text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        let looksRetail = t.split(whereSeparator: \.isWhitespace).count == 1 || has(retail, t)
        for (re, cat, ambiguous) in compiled where has(re, t) {
            if ambiguous && !looksRetail { continue }
            return cat
        }
        return nil
    }

    struct Learned { var exact: [String: String] = [:]; var first: [String: String] = [:] }

    /// history newest first: the first seen wins
    static func learn(_ history: [(description: String, category: String)]) -> Learned {
        var l = Learned()
        for h in history {
            let n = norm(h.description)
            guard !n.isEmpty, !h.category.isEmpty else { continue }
            if l.exact[n] == nil { l.exact[n] = h.category }
            if let w = n.split(separator: " ").first.map(String.init), w.count >= 4, l.first[w] == nil { l.first[w] = h.category }
        }
        return l
    }

    static func category(_ text: String, _ learned: Learned, known: (String) -> Bool = { _ in true }) -> String? {
        let n = norm(text)
        guard n.count >= 3 else { return nil }
        func pick(_ c: String?) -> String? { c.flatMap { known($0) ? $0 : nil } }
        return pick(learned.exact[n]) ?? pick(n.split(separator: " ").first.flatMap { learned.first[String($0)] }) ?? pick(builtin(text))
    }
}
