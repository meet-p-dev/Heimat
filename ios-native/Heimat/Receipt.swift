import Foundation

/// Reads a shop receipt — the lines the camera's text recognition found — into
/// what an expense needs: the shop, the day, the total and the lines on it.
///
/// Only Foundation, so it is tested with plain swiftc (scripts/test-ledger-swift.sh)
/// against tests/receipt-vectors.json. Money is never guessed: every amount comes
/// from a figure printed on the receipt, and the items are offered for a split only
/// when they add up to the total to the cent.
enum Receipt {
    struct Item: Equatable {
        var name: String
        /// cents
        var minor: Int
    }

    struct Result: Equatable {
        var store: String?
        /// yyyy-MM-dd
        var date: String?
        /// cents
        var total: Int?
        /// read from a "Summe" / "Zu zahlen" line (or confirmed by the card or cash line), not the largest figure
        var totalSure = false
        var items: [Item] = []
        /// money taken off that belongs to no single line (Leergut, a coupon), in cents
        var discount = 0
        /// Splitlife's category for the shop, when the shop says it
        var category: String?

        /// the lines, less what was taken off, come to the total exactly
        var itemsMatch: Bool {
            guard let total, !items.isEmpty, items.allSatisfy({ $0.minor > 0 }) else { return false }
            return items.reduce(0) { $0 + $1.minor } - discount == total
        }
    }

    // MARK: amounts

    struct Amount: Equatable {
        var minor: Int
        /// where the figure starts in the row, as a character offset
        var at: Int
    }

    /// "1,49", "12.50", "-0,30", "0,30-", "1.234,56" — two decimals, never part of a
    /// date (03.10.2026), a percentage (19,00%) or a longer number.
    private static let amountRE = try! NSRegularExpression(
        pattern: #"(?<![\d.,])(-\s?)?(\d{1,3}(?:\.\d{3})+|\d{1,5})([.,])(\d{2})(?![\d%]|[.,]\d)(\s?-(?![\d]))?"#)

    static func amounts(_ row: String) -> [Amount] {
        let ns = row as NSString
        return amountRE.matches(in: row, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            let whole = ns.substring(with: m.range(at: 2)), sep = ns.substring(with: m.range(at: 3))
            // "1.234.56" is not an amount
            if sep == "." && whole.contains(".") { return nil }
            guard let w = Int(whole.replacingOccurrences(of: ".", with: "")), let c = Int(ns.substring(with: m.range(at: 4))) else { return nil }
            let negative = m.range(at: 1).location != NSNotFound || m.range(at: 5).location != NSNotFound
            let v = w * 100 + c
            return Amount(minor: negative ? -v : v, at: m.range.location)
        }
    }

    // MARK: kinds of row

    private static func re(_ p: String) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: [.caseInsensitive]) }
    private static func has(_ r: NSRegularExpression, _ s: String) -> Bool {
        r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    /// what the receipt calls the amount to pay. "Zwischensumme" is a subtotal.
    private static let totalRE = re(#"\b(zu\s*zahlen|zu\s*zahl|gesamtsumme|endsumme|summe|total|gesamtbetrag|rechnungsbetrag|zahlbetrag|gesamt|betrag)\b"#)
    private static let notTotalRE = re(#"sub\s*total|zwischensumme|netto|mwst|ust\b|steuer|rabatt|ersparnis|gespart|sparen|bonus|punkte|payback"#)
    /// how it was paid — a figure on one of these repeats the total
    private static let paymentRE = re(#"\b(karte|kartenzahlung|girocard|ec[- ]?karte|ec[- ]?cash|visa|mastercard|maestro|amex|kreditkarte|bar|paypal|apple\s*pay|google\s*pay|zahlung|bezahlt)\b"#)
    /// paid by card, which repeats the exact total (cash handed over need not)
    private static let cardRE = re(#"\b(karte|kartenzahlung|girocard|ec[- ]?karte|ec[- ]?cash|visa|mastercard|maestro|amex|kreditkarte|paypal|apple\s*pay|google\s*pay)\b"#)
    /// cash handed over and change: not the total
    private static let cashRE = re(#"gegeben|geg\.|rückgeld|ruckgeld|wechselgeld|zurück"#)
    /// "2 x 0,99", "1,076 kg x 1,20 EUR/kg": how a line's price came about
    private static let qualifierRE = re(#"(\d\s*(x|×|\*)\s*\d)|((kg|stk|st\.|stück|g)\s*(x|×|\*))|(/\s*kg)|(eur\s*/)"#)
    /// "1,20 EUR/kg": a price per unit, never a line's own price
    private static let unitPriceRE = re(#"(/\s*(kg|l|stk|st|100\s*g))|((eur|€)\s*/)"#)
    /// lines that are about the receipt, the till or the tax — never something bought
    private static let notItemRE = re(#"\b(sub\s*total|zwischensumme|mwst|ust|steuer|netto|brutto|tel|telefon|fax|uid|st-?nr|steuer-?nr|www|http|bon|beleg|kasse|kassierer|terminal|trace|tse|signatur|seriennummer|transaktion|datum|uhrzeit|posten|filiale|öffnungszeiten|vielen dank|danke|iban|bic|kundenbeleg|genehmigung|autorisierung)\b"#)
    /// a line taking money off — Lidl's "Preisvorteil", a coupon, empties returned
    private static let reductionRE = re(#"preisvorteil|rabatt|coupon|gutschein|nachlass|leergut|pfandrückgabe|pfandruckgabe|aktion|abzug|sofortrabatt"#)
    /// "EUR" over the price column is a heading, not something bought
    private static let currencyOnlyRE = re(#"^\s*(eur|euro|€)\s*$"#)
    /// these take money off even when the minus isn't printed
    private static let alwaysOffRE = re(#"preisvorteil|rabatt|nachlass|sofortrabatt|pfandrückgabe|pfandruckgabe|leergut"#)
    private static let dateRE = try! NSRegularExpression(pattern: #"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)"#)

    private static func letters(_ s: String) -> Int { s.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count }

    // MARK: reading

    /// - Parameters:
    ///   - rows: the receipt top to bottom, one printed line each (what is left of a
    ///     line and what is right of it, joined)
    ///   - now: today, so a misread year can't put it in the future
    static func read(_ rows: [String], now: Date = Date()) -> Result {
        let rows = rows.map { $0.replacingOccurrences(of: "\t", with: "  ").trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var r = Result()
        let amt = rows.map(amounts)

        // the total: the first line from the top that says so and shows a figure
        var totalRow: Int?
        for (i, row) in rows.enumerated() where has(totalRE, row) && !has(notTotalRE, row) && !has(cashRE, row) {
            if let a = amt[i].last, a.minor > 0 {
                r.total = a.minor; totalRow = i
                break
            }
            // "SUMME" on one line, the figure alone on the next
            if i + 1 < rows.count, let a = amt[i + 1].last, a.minor > 0, letters(rows[i + 1]) <= 4 {
                r.total = a.minor; totalRow = i
                break
            }
        }
        // how it was paid: a card line repeats the total
        let paidRows = rows.indices.filter { has(paymentRE, rows[$0]) && !has(cashRE, rows[$0]) && !(amt[$0].last.map { $0.minor <= 0 } ?? true) }
        let cardRows = paidRows.filter { has(cardRE, rows[$0]) }
        if r.total == nil, let p = paidRows.first {
            r.total = amt[p].last?.minor; totalRow = p
        }

        // the lines bought: everything above the total with a price at its end
        let end = totalRow ?? (paidRows.first ?? rows.count)
        var firstItemRow: Int?
        var pendingName: String?
        for i in 0..<end {
            let row = rows[i]
            guard let price = amt[i].last else {
                // a name whose price is on the next line
                let l = letters(row)
                pendingName = l >= 3 && !has(notItemRE, row) && !has(totalRE, row) ? row : nil
                continue
            }
            if has(notItemRE, row) || has(cashRE, row) || has(totalRE, row) && !has(reductionRE, row) || has(dateRE, row) { pendingName = nil; continue }
            let ns = row as NSString
            var name = clean(ns.substring(to: price.at))
            if has(unitPriceRE, row) || has(qualifierRE, row) && (amt[i].count >= 2 || letters(name) < 3) {
                // "2 x 0,99   1,98" under a name printed alone: that is the line's price
                if let n = pendingName { name = clean(n) } else { pendingName = nil; continue }
            } else if letters(name) < 2 || has(currencyOnlyRE, name) {
                // a price alone on its line belongs to the name just above it
                guard let n = pendingName else { continue }
                name = clean(n)
            }
            pendingName = nil
            if firstItemRow == nil { firstItemRow = i }
            if price.minor < 0 || has(alwaysOffRE, row) {
                let off = abs(price.minor)
                // "Preisvorteil" belongs to the line just above it
                if let last = r.items.indices.last, has(reductionRE, row) && !has(re("leergut|pfandr"), row) && r.items[last].minor > off {
                    r.items[last].minor -= off
                } else {
                    r.discount += off
                }
                continue
            }
            r.items.append(Item(name: name, minor: price.minor))
        }

        // the shop: a chain we know in the lines above the first item, or the first line that reads like a name
        let header = Array(rows.prefix(min(firstItemRow ?? totalRow ?? 10, 10)))
        if let (name, cat) = chain(in: header) {
            r.store = name; r.category = cat
        } else {
            r.store = header.first { row in
                letters(row) >= 3 && Double(letters(row)) / Double(max(row.count, 1)) > 0.5 && amounts(row).isEmpty
                    && !has(notItemRE, row) && !has(re(#"kassenbon|rechnung|quittung|willkommen|beleg|eur\b"#), row)
            }.map(titled)
        }

        // Sure means two things on the receipt agree — a card line repeats it, or the
        // lines add up to it to the cent. A "Summe" alone is not enough: a misread
        // digit would go through unnoticed, and a card line saying something else
        // means one of them was misread.
        if let total = r.total {
            let after = totalRow ?? -1
            let confirmed = cardRows.contains { $0 > after && amt[$0].last?.minor == total }
            let contradicted = cardRows.contains { $0 > after && $0 <= after + 3 && amt[$0].last.map { $0.minor != total } ?? false }
            r.totalSure = !contradicted && (confirmed || r.itemsMatch)
        }

        r.date = date(in: rows, now: now)
        // no figure at all: whatever the first line says, this isn't a receipt we can read
        if r.total == nil && r.items.isEmpty { r.store = nil; r.category = nil }
        return r
    }

    /// "BIO HAFERDRINK  " → "Bio Haferdrink"; what is printed, tidied
    private static func clean(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        t = t.trimmingCharacters(in: CharacterSet(charactersIn: " *#:-€").union(.whitespaces))
        if t.hasSuffix(" EUR") { t = String(t.dropLast(4)) }
        return titled(t)
    }

    private static func titled(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard letters(t) > 4, t == t.uppercased() else { return t }
        return t.lowercased().split(separator: " ", omittingEmptySubsequences: true).map { w in
            w.prefix(1).uppercased() + w.dropFirst()
        }.joined(separator: " ")
    }

    /// the first date that can be the day of the purchase: not in the future, not years ago
    private static func date(in rows: [String], now: Date) -> String? {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let today = cal.dateComponents([.year, .month, .day], from: now)
        for row in rows {
            let ns = row as NSString
            for m in dateRE.matches(in: row, range: NSRange(location: 0, length: ns.length)) {
                guard let d = Int(ns.substring(with: m.range(at: 1))), let mo = Int(ns.substring(with: m.range(at: 2))),
                      var y = Int(ns.substring(with: m.range(at: 3))) else { continue }
                if y < 100 { y += 2000 }
                guard (1...12).contains(mo), (1...31).contains(d),
                      let when = cal.date(from: DateComponents(year: y, month: mo, day: d)),
                      cal.component(.day, from: when) == d,
                      let t = cal.date(from: today) else { continue }
                let days = cal.dateComponents([.day], from: when, to: t).day ?? 0
                guard days >= -1, days <= 730 else { continue }
                return String(format: "%04d-%02d-%02d", y, mo, d)
            }
        }
        return nil
    }

    /// chains people in Germany shop at, with the category their receipts belong in
    private static let chains: [(pattern: String, name: String, category: String?)] = [
        (#"\brewe\b"#, "REWE", "groceries"), (#"\blidl\b"#, "Lidl", "groceries"),
        (#"aldi\s*s[uü]d"#, "ALDI SÜD", "groceries"), (#"aldi\s*nord"#, "ALDI Nord", "groceries"), (#"\baldi\b"#, "ALDI", "groceries"),
        (#"\bedeka\b"#, "EDEKA", "groceries"), (#"\bkaufland\b"#, "Kaufland", "groceries"),
        (#"netto\s*marken|\bnetto\s*city|^netto$"#, "Netto", "groceries"), (#"\bpenny\b"#, "PENNY", "groceries"),
        (#"\bnorma\b"#, "NORMA", "groceries"), (#"\bglobus\b"#, "Globus", "groceries"), (#"\btegut\b"#, "tegut", "groceries"),
        (#"denn'?s\s*bio"#, "denn's Biomarkt", "groceries"), (#"\balnatura\b"#, "Alnatura", "groceries"),
        (#"bio\s*company"#, "Bio Company", "groceries"), (#"\bmarktkauf\b"#, "Marktkauf", "groceries"),
        (#"\bdm[- ]drogerie|^dm$|\bdm\s*markt"#, "dm", "household"), (#"\brossmann\b"#, "Rossmann", "household"),
        (#"\bm[uü]ller\s*(drogerie|handels)"#, "Müller", "household"),
        (#"\bikea\b"#, "IKEA", "household"), (#"\baction\b"#, "Action", "household"), (#"\btedi\b"#, "TEDi", "household"),
        (#"\bobi\b"#, "OBI", "household"), (#"\bhornbach\b"#, "Hornbach", "household"), (#"\bbauhaus\b"#, "Bauhaus", "household"),
        (#"media\s*markt"#, "MediaMarkt", nil), (#"\bsaturn\b"#, "Saturn", nil),
        (#"mc\s*donald"#, "McDonald's", "eatout"), (#"burger\s*king"#, "Burger King", "eatout"), (#"\bstarbucks\b"#, "Starbucks", "eatout"),
        (#"\bsubway\b"#, "Subway", "eatout"), (#"\bvapiano\b"#, "Vapiano", "eatout"), (#"\bkfc\b"#, "KFC", "eatout"),
        (#"back[- ]?werk"#, "BackWerk", "eatout"), (#"\bditsch\b"#, "Ditsch", "eatout"),
        (#"\baral\b"#, "Aral", "transport"), (#"\bshell\b"#, "Shell", "transport"), (#"\besso\b"#, "Esso", "transport"),
        (#"deutsche\s*bahn|db\s*fernverkehr|db\s*regio"#, "Deutsche Bahn", "transport"),
    ]

    private static func chain(in rows: [String]) -> (String, String?)? {
        for c in chains {
            let r = re(c.pattern)
            if rows.contains(where: { has(r, $0.trimmingCharacters(in: .whitespaces)) }) { return (c.name, c.category) }
        }
        return nil
    }
}
