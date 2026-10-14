import Foundation

/// Bringing a group over from another app: Splitwise, Tricount, Settle Up, Splid, or any
/// spreadsheet of shared expenses (CSV, or Excel through Xlsx.swift). The file is recognised by
/// its layout — one column per person (Splitwise), "Paid by X / Paid for X" (Tricount), "Who
/// paid" with a share column per person (Settle Up), "Who paid / For whom" (Splid, spreadsheets)
/// — and every row becomes who paid and who owes, so balances come out exactly as in the file;
/// the server (import_group) refuses the import otherwise. The rules are written out in
/// src/lib/importExpenses.ts; this is the same, held to tests/expense-import-vectors.json.
enum ExpenseImport {
    struct Person: Equatable, Encodable { var key: String; var name: String }
    struct Expense: Equatable, Encodable {
        var d: String; var t: String; var c: String; var cur: String; var total: Int
        var paid: [String: Int]; var owed: [String: Int]
    }
    struct Payment: Equatable, Encodable { var d: String; var t: String; var from: String; var to: String; var cur: String; var total: Int }
    enum Totals: String { case yes, rounding, no, none }
    enum Layout: String { case net, paidfor, shares, list }
    struct File: Equatable {
        var name: String
        var layout: Layout
        var people: [Person]
        var expenses: [Expense]
        var payments: [Payment]
        /// "key|EUR" → minor units, non-zero only
        var balances: [String: Int]
        var totals: Totals
        var skipped: Int
        var bad: [Int]
        var from: String?
        var to: String?
        var currencies: [String]
    }
    /// which column is what (column numbers, -1 = none)
    struct ColumnMap: Equatable {
        var date = -1, description = -1, amount = -1, payer = -1, forWhom = -1, currency = -1, category = -1
    }
    enum Result: Equatable {
        case ok(File)
        case empty
        case tooLarge
        /// the file's columns weren't recognised: its header and first rows, for "which column is what?"
        case notRecognised(header: [String], sample: [[String]])
    }

    static let maxRows = 5000
    static let maxPeople = 49

    // MARK: reading cells

    private static func groups(_ pattern: String, _ s: String, _ opts: NSRegularExpression.Options = []) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: opts),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }
    private static func test(_ pattern: String, _ s: String) -> Bool { groups(pattern, s, .caseInsensitive) != nil }
    static func cut(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
    private static func low(_ s: String) -> String { cut(s).lowercased() }

    static func splitCsv(_ text: String, _ sep: Unicode.Scalar) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], cell = String.UnicodeScalarView(), q = false
        let u = Array(text.unicodeScalars)
        var i = 0
        while i < u.count {
            let ch = u[i]
            if q {
                if ch == "\"" { if i + 1 < u.count && u[i + 1] == "\"" { cell.append("\""); i += 1 } else { q = false } }
                else { cell.append(ch) }
            } else if ch == "\"" { q = true }
            else if ch == sep { row.append(String(cell)); cell = .init() }
            else if ch == "\n" || ch == "\r" {
                if ch == "\r" && i + 1 < u.count && u[i + 1] == "\n" { i += 1 }
                row.append(String(cell)); rows.append(row); row = []; cell = .init()
            } else { cell.append(ch) }
            i += 1
        }
        if !cell.isEmpty || !row.isEmpty { row.append(String(cell)); rows.append(row) }
        return rows
    }
    /// a CSV's rows: comma, semicolon or tab, whichever the first line uses most
    static func csvTable(_ text: String) -> [[String]] {
        var clean = text
        if clean.hasPrefix("\u{FEFF}") { clean.removeFirst() }
        var first = String(clean.unicodeScalars.prefix { $0 != "\n" })
        if first.hasSuffix("\r") { first.removeLast() }
        func count(_ c: Unicode.Scalar) -> Int { first.unicodeScalars.filter { $0 == c }.count }
        let sep: Unicode.Scalar = count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ","
        return splitCsv(clean, sep)
    }

    private static func validDate(_ y: Int, _ m: Int, _ d: Int) -> String? {
        guard (2000...2100).contains(y), (1...12).contains(m), d >= 1 else { return nil }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        guard d <= days else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }
    private static let months: [String: Int] = [
        "jan": 1, "feb": 2, "mar": 3, "mär": 3, "mae": 3, "apr": 4, "may": 5, "mai": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
        "oct": 10, "okt": 10, "nov": 11, "dec": 12, "dez": 12,
    ]
    /// the dates src/lib/importExpenses.ts reads, the same way
    static func date(_ s: String, monthFirst: Bool = false) -> String? {
        let t = cut(s).replacingOccurrences(of: "[T ]\\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?\\s*([ap]\\.?m\\.?)?(\\s*(z|[+-]\\d{2}:?\\d{2}))?$", with: "",
                                            options: [.regularExpression, .caseInsensitive]).trimmingCharacters(in: .whitespacesAndNewlines)
        if let g = groups("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$", t) { return validDate(Int(g[1])!, Int(g[2])!, Int(g[3])!) }
        if let g = groups("^(\\d{4})(\\d{2})(\\d{2})$", t) { return validDate(Int(g[1])!, Int(g[2])!, Int(g[3])!) }
        if let g = groups("^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2}|\\d{4})$", t) {
            let y = g[3].count == 2 ? 2000 + Int(g[3])! : Int(g[3])!
            return monthFirst ? validDate(y, Int(g[1])!, Int(g[2])!) : validDate(y, Int(g[2])!, Int(g[1])!)
        }
        if let g = groups("^(\\d{1,2})\\.?\\s+([a-zäé]{3,})\\.?,?\\s+(\\d{4})$", t, .caseInsensitive), let m = months[String(g[2].lowercased().prefix(3))] {
            return validDate(Int(g[3])!, m, Int(g[1])!)
        }
        if let g = groups("^([a-zäé]{3,})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$", t, .caseInsensitive), let m = months[String(g[1].lowercased().prefix(3))] {
            return validDate(Int(g[3])!, m, Int(g[2])!)
        }
        if let g = groups("^(\\d{5})(\\.\\d+)?$", t), let n = Int(g[1]), n >= 36526, n <= 73050 {
            // Excel's day 1 is 1 Jan 1900, counted as if 1900 were a leap year: day 25569 is 1 Jan 1970
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "UTC")!
            let c = cal.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(n - 25569) * 86400))
            return validDate(c.year!, c.month!, c.day!)
        }
        return nil
    }
    /// does the file write the month first? only when some date can't be day-first
    private static func monthFirstIn(_ cells: [String]) -> Bool {
        var dayFirst = false, monthFirst = false
        for c in cells {
            guard let g = groups("^(\\d{1,2})[./-](\\d{1,2})[./-]\\d{2,4}", cut(c)) else { continue }
            if Int(g[1])! > 12 { dayFirst = true }
            if Int(g[2])! > 12 { monthFirst = true }
        }
        return monthFirst && !dayFirst
    }

    private static let symbols: [String: String] = ["€": "EUR", "£": "GBP", "$": "USD", "US$": "USD", "₹": "INR", "¥": "JPY", "₩": "KRW", "CHF": "CHF",
                                                    "zł": "PLN", "kr": "SEK", "₺": "TRY", "R$": "BRL", "A$": "AUD", "C$": "CAD"]
    static func currency(_ s: String, _ fallback: String) -> String {
        let t = cut(s)
        if t.isEmpty { return fallback.uppercased() }
        return symbols[t] ?? t.uppercased()
    }

    /// minor units; zeros beyond what the currency has are dropped first ("1000.00" yen)
    static func amount(_ s: String, _ cur: String) -> Int? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        let dg = Money.digits(cur)
        if let g = groups("^([-\u{2212}]?[0-9]+)[.,]([0-9]+)$", t), g[2].count > dg, g[2].dropFirst(dg).allSatisfy({ $0 == "0" }) {
            let keep = String(g[2].prefix(dg))
            t = keep.isEmpty ? g[1] : "\(g[1]).\(keep)"
        }
        return Money.parse(t, cur)
    }
    /// a spreadsheet amount: a currency sign or code around it allowed, and a computed share with
    /// more decimals than the currency has rounded half away from zero
    static func sheetAmount(_ s: String, _ cur: String) -> Int? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^[^\\d\\-\u{2212}+.,]+|[^\\d.,]+$", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : nil }
        if let exact = amount(t, cur) { return exact }
        guard let g = groups("^([-\u{2212}]?)(\\d+)\\.(\\d+)$", t), let x = Double("\(g[2]).\(g[3])") else { return nil }
        let v = Int((x * pow(10, Double(Money.digits(cur))) + 1e-9).rounded())
        return g[1].isEmpty ? v : -v
    }

    // MARK: recognising columns

    private static let dateHead = "^(date|datum|date & time|date and time|date et heure|fecha|data|day|tag|when|wann|transaction date|expense date)$"
    private static let descHead = "^(description|title|titel|purpose|zweck|what|was|beschreibung|bezeichnung|name|libellé|libelle|concept|concepto|item|subject|expense|ausgabe|titre|descripción|descripcion|descrizione)$"
    private static let catHead = "^(category|kategorie|catégorie|categorie|categoría|categoria)$"
    private static let amountHead = "^(cost|amount|total|betrag|kosten|montant|importe|importo|summe|price|preis|sum|value|wert|gesamt)( \\([^)]*\\))?$"
    private static let curHead = "^(currency|währung|waehrung|devise|moneda|valuta|cur)$"
    private static let payerHead = "^(paid by|who paid|payer|bezahlt von|gezahlt von|wer hat bezahlt|payé par|paye par|pagado por|pagato da|from|von)$"
    private static let forHead = "^(for whom|paid for|split between|split among|participants|für wen|fuer wen|bezahlt für|pour qui|para quién|para quien|per chi|shared with|beneficiaries|to|für|teilnehmer)$"
    private static let typeHead = "^(type|transaction type|art|typ|is reimbursement|kind)$"
    private static let perPaid = "^(?:paid by|bezahlt von|gezahlt von|payé par|paye par|pagado por|pagato da)\\s+(.+)$"
    private static let perOwed = "^(?:paid for|bezahlt für|bezahlt fuer|payé pour|paye pour|pagado para|pagato per|impacted to|share|anteil|part de)\\s+(.+)$"
    private static let payment = "^(payment|zahlung|pago|paiement|pagamento|betaling|płatność|transfer|money transfer|überweisung|ueberweisung|reimbursement|erstattung|rückzahlung|remboursement|reembolso|rimborso|yes|true|ja|oui|sí|si)$"
    private static let paymentDesc = "\\b(paid|pays|settle|settled|repaid|reimburs|erstattet|zurückgezahlt|bezahlt an|a payé|pagó)\\b"
    private static let total = "^(total balance|gesamtsaldo|saldo total|solde total|saldo totale|totaal saldo|total|totals|summe|gesamt|balance|saldo|sum)$"
    private static let notAPerson = "(rate|kurs|exchange|default|converted|umgerechnet|\\bid\\b|balance|saldo|total|summe|sum|amount|betrag)"
    private static let everyone = "^(all|everyone|everybody|alle|jeder|tous|tout le monde|todos|tutti|\\*)$"
    private static func head(_ pattern: String) -> (String) -> Bool { { h in test(pattern, low(h)) } }

    private static let category: [(String, String)] = [
        ("^(rent|mortgage|miete)$", "rent"),
        ("^(groceries|liquor|lebensmittel|courses|supermarket)$", "groceries"),
        ("^(electricity|heat/gas|water|utilities - other|utilities|trash|cleaning|nebenkosten)$", "utilities"),
        ("^(tv/phone/internet|internet|phone)$", "internet"),
        ("^(dining out|food and drink - other|restaurant|restaurants|food & drink|food|essen)$", "eatout"),
        ("^(bus/train|car|gas/fuel|parking|plane|taxi|transportation - other|bicycle|transport|transportation|travel|fuel)$", "transport"),
        ("^(household supplies|furniture|maintenance|home - other|electronics|pets|services|household|haushalt)$", "household"),
    ]
    static func categoryOf(_ cat: String, _ description: String) -> String {
        let s = low(cat)
        for (re, c) in category where groups(re, s) != nil { return c }
        return (s.isEmpty ? nil : Suggest.builtin(s)) ?? Suggest.builtin(description) ?? "other"
    }

    /// "wg-berlin_2024-05-03_export.csv" → "Wg berlin"
    static func name(fromFile file: String) -> String {
        var s = file
        for (re, with) in [("\\.[a-z0-9]+$", ""), ("[_ -]*[0-9]{4}-[0-9]{2}-[0-9]{2}[_ -]*export$", ""), ("[_-]+", " "), ("\\s+", " ")] {
            s = s.replacingOccurrences(of: re, with: with, options: [.regularExpression, .caseInsensitive])
        }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, s.lowercased() != "export" else { return "" }
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// names in a "for whom" cell: "Anna, Ben & Chris", "Anna; Ben", "Anna und Ben"
    private static func names(in s: String) -> [String] {
        cut(s).replacingOccurrences(of: "\\s*(?:[,;+&/|]|\\band\\b|\\bund\\b|\\bet\\b|\\by\\b|\\be\\b)\\s*", with: "\u{1F}", options: [.regularExpression, .caseInsensitive])
            .components(separatedBy: "\u{1F}").map(cut).filter { !$0.isEmpty }
    }

    /// `r` split equally among `keys` (in that order); the first ones get the odd cents
    private static func equalParts(_ r: Int, _ keys: [String]) -> [String: Int] {
        var out: [String: Int] = [:]
        let base = Int((Double(r) / Double(keys.count)).rounded(.down))
        var left = r - base * keys.count
        for k in keys { out[k] = base + (left > 0 ? 1 : 0); if left > 0 { left -= 1 } }
        return out
    }
    private static func clip(_ s: String, _ n: Int) -> String {
        s.utf16.count <= n ? s : String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
    }

    // MARK: one row, any layout

    private struct Row {
        var line: Int; var d: String; var t: String; var cat: String; var cur: String; var cost: Int?; var pay: Bool
        var paid: [String: Int]? = nil; var owed: [String: Int]? = nil; var net: [String: Int]? = nil
    }
    private final class Book {
        let keys: [String]
        var expenses: [Expense] = [], payments: [Payment] = [], bad: [Int] = [], skipped = 0
        var balances: [String: Int] = [:], from: String?, to: String?, tooLarge = false
        init(_ keys: [String]) { self.keys = keys }

        func add(_ row: Row) {
            var r = row
            func val(_ m: [String: Int]?, _ k: String) -> Int { m?[k] ?? 0 }
            var net: [Int]
            var exact = false
            if let n = r.net { net = keys.map { n[$0] ?? 0 } }
            else {
                let sp = keys.reduce(0) { $0 + val(r.paid, $1) }
                var so = keys.reduce(0) { $0 + val(r.owed, $1) }
                if sp != so, r.owed != nil, so != 0, abs(sp - so) <= keys.count {
                    let big = keys.reduce(keys[0]) { a, k in abs(val(r.owed, k)) > abs(val(r.owed, a)) ? k : a }
                    r.owed![big] = val(r.owed, big) + sp - so
                    so = sp
                }
                if sp != so { bad.append(r.line); return }
                net = keys.map { val(r.paid, $0) - val(r.owed, $0) }
                exact = sp > 0 && keys.allSatisfy { val(r.paid, $0) >= 0 && val(r.owed, $0) >= 0 }
            }
            if net.reduce(0, +) != 0 { bad.append(r.line); return }
            let up = keys.indices.filter { net[$0] > 0 }.map { keys[$0] }
            let down = keys.indices.filter { net[$0] < 0 }.map { keys[$0] }
            if up.isEmpty { skipped += 1; return }
            if expenses.count + payments.count >= ExpenseImport.maxRows { tooLarge = true; return }
            if from == nil || r.d < from! { from = r.d }
            if to == nil || r.d > to! { to = r.d }
            for (j, k) in keys.enumerated() where net[j] != 0 { balances["\(k)|\(r.cur)", default: 0] += net[j] }
            func nk(_ k: String) -> Int { net[keys.firstIndex(of: k)!] }
            let sumUp = up.reduce(0) { $0 + nk($1) }
            let desc = ExpenseImport.clip(r.t, 200)
            if r.pay && up.count == 1 && down.count == 1 {
                payments.append(Payment(d: r.d, t: desc, from: up[0], to: down[0], cur: r.cur, total: sumUp))
                return
            }
            var owed: [String: Int] = [:], paid: [String: Int] = [:]
            let total: Int
            if exact {
                for k in keys { if val(r.paid, k) != 0 { paid[k] = val(r.paid, k) }; if val(r.owed, k) != 0 { owed[k] = val(r.owed, k) } }
                total = keys.reduce(0) { $0 + val(r.paid, $1) }
            } else {
                let cost = r.cost ?? 0
                total = cost >= sumUp && cost > 0 ? cost : sumUp
                for k in down { owed[k] = -nk(k) }
                let mine = ExpenseImport.equalParts(total - sumUp, up)
                for k in up {
                    if mine[k]! != 0 { owed[k] = mine[k]! }
                    paid[k] = nk(k) + mine[k]!
                }
            }
            expenses.append(Expense(d: r.d, t: desc, c: ExpenseImport.categoryOf(r.cat, desc), cur: r.cur, total: total, paid: paid, owed: owed))
        }
    }

    private static func finish(_ b: Book, _ people: [Person], _ layout: Layout, _ fileName: String, _ totals: [String: Int]) -> Result {
        if b.tooLarge { return .tooLarge }
        if b.expenses.isEmpty && b.payments.isEmpty { return .empty }
        let bal = b.balances.filter { $0.value != 0 }
        var state = Totals.none
        if !totals.isEmpty {
            let ids = Set(bal.keys).union(totals.filter { $0.value != 0 }.keys)
            let worst = ids.map { abs((bal[$0] ?? 0) - (totals[$0] ?? 0)) }.max() ?? 0
            state = worst == 0 ? .yes : worst <= 5 ? .rounding : .no
        }
        let currencies = Array(Set(b.expenses.map(\.cur) + b.payments.map(\.cur))).sorted()
        return .ok(File(name: name(fromFile: fileName), layout: layout, people: people, expenses: b.expenses, payments: b.payments, balances: bal,
                        totals: state, skipped: b.skipped, bad: b.bad, from: b.from, to: b.to, currencies: currencies))
    }

    // MARK: the layouts

    private struct Ctx { var rows: [[String]]; var hi: Int; var head: [String]; var fallback: String; var fileName: String }
    private static func col(_ head: [String], _ pattern: String) -> Int { head.firstIndex { test(pattern, low($0)) } ?? -1 }
    private static func cell(_ r: [String], _ i: Int) -> String { i >= 0 && i < r.count ? cut(r[i]) : "" }
    private static func dataRows(_ c: Ctx) -> [(r: [String], line: Int)] {
        c.rows.enumerated().filter { $0.offset > c.hi && $0.element.contains { !cut($0).isEmpty } }.map { ($0.element, $0.offset + 1) }
    }
    private static func isTotalRow(_ r: [String], _ iDate: Int, _ iDesc: Int) -> Bool {
        date(cell(r, iDate)) == nil && (test(total, cell(r, iDesc)) || test(total, cell(r, 0)))
    }
    private struct Base { var d: String?; var cur: String; var t: String; var cat: String; var pay: Bool; var line: Int }
    private struct Common { var iDate: Int; var iDesc: Int; var iAmt: Int; var base: ([String], Int) -> Base }
    private static func common(_ c: Ctx) -> Common {
        let iDate = col(c.head, dateHead), iDesc = col(c.head, descHead), iCat = col(c.head, catHead), iCur = col(c.head, curHead)
        let iAmt = col(c.head, amountHead), iType = col(c.head, typeHead)
        let mf = monthFirstIn(dataRows(c).map { cell($0.r, iDate) })
        return Common(iDate: iDate, iDesc: iDesc, iAmt: iAmt) { r, line in
            let cat = cell(r, iCat)
            let pay = test(payment, cell(r, iType)) || (iType < 0 && test(payment, cat))
            return Base(d: date(cell(r, iDate), monthFirst: mf), cur: currency(cell(r, iCur), c.fallback), t: cell(r, iDesc), cat: cat, pay: pay, line: line)
        }
    }
    private static func isCode(_ cur: String) -> Bool { groups("^[A-Z]{3}$", cur) != nil }

    /// Splitwise: Date, Description, Category, Cost, Currency, then one column per person
    private static func netLayout(_ c: Ctx) -> Result? {
        let h = c.head
        var last = h.count
        while last > 5 && cut(h[last - 1]).isEmpty { last -= 1 }
        guard last >= 7, test(curHead, low(h[4])) || test(amountHead, low(h[3])), last - 5 <= maxPeople else { return nil }
        let people = h[5..<last].enumerated().map { Person(key: String($0.offset), name: cut($0.element).isEmpty ? "Person \($0.offset + 1)" : cut($0.element)) }
        let keys = people.map(\.key)
        let b = Book(keys)
        var totals: [String: Int] = [:]
        let mf = monthFirstIn(dataRows(c).map { cell($0.r, 0) })
        for (r, line) in dataRows(c) {
            let cur = currency(cell(r, 4), c.fallback)
            let nets = keys.indices.map { j in amount(cell(r, 5 + j).isEmpty ? "0" : cell(r, 5 + j), cur) }
            if date(cell(r, 0), monthFirst: mf) == nil && test(total, cell(r, 1)) {
                if isCode(cur) && nets.allSatisfy({ $0 != nil }) { for (j, k) in keys.enumerated() { totals["\(k)|\(cur)", default: 0] += nets[j]! } }
                continue
            }
            guard let d = date(cell(r, 0), monthFirst: mf), isCode(cur), let cost = amount(cell(r, 3), cur), nets.allSatisfy({ $0 != nil }) else { b.bad.append(line); continue }
            b.add(Row(line: line, d: d, t: cell(r, 1), cat: cell(r, 2), cur: cur, cost: cost,
                      pay: test("^(payment|zahlung|pago|paiement|pagamento|betaling|płatność)$", cell(r, 2)),
                      net: Dictionary(uniqueKeysWithValues: keys.enumerated().map { ($0.element, nets[$0.offset]!) })))
        }
        return finish(b, people, .net, c.fileName, totals)
    }

    /// Tricount, Sesterce: "Paid by X" and "Paid for X" for each person
    private static func paidForLayout(_ c: Ctx) -> Result? {
        var by: [(String, Int)] = [], forr: [(String, Int)] = []
        for (i, h) in c.head.enumerated() {
            if let a = groups(perPaid, cut(h), .caseInsensitive) { by.append((cut(a[1]).lowercased(), i)) }
            else if let o = groups(perOwed, cut(h), .caseInsensitive) { forr.append((cut(o[1]).lowercased(), i)) }
        }
        guard by.count >= 1, forr.count >= 2 else { return nil }
        var names: [String] = [], display: [String: String] = [:]
        for h in c.head {
            guard let m = groups(perPaid, cut(h), .caseInsensitive) ?? groups(perOwed, cut(h), .caseInsensitive) else { continue }
            let n = cut(m[1]).lowercased()
            if display[n] == nil { display[n] = cut(m[1]); names.append(n) }
        }
        guard names.count <= maxPeople else { return nil }
        let people = names.enumerated().map { Person(key: String($0.offset), name: display[$0.element]!) }
        let keyOf = Dictionary(uniqueKeysWithValues: names.enumerated().map { ($0.element, String($0.offset)) })
        let cm = common(c)
        guard cm.iDate >= 0 else { return nil }
        let b = Book(people.map(\.key))
        for (r, line) in dataRows(c) {
            if isTotalRow(r, cm.iDate, cm.iDesc) { continue }
            let x = cm.base(r, line)
            var paid: [String: Int] = [:], owed: [String: Int] = [:]
            var broken = x.d == nil || !isCode(x.cur)
            for (n, i) in by { if let v = sheetAmount(cell(r, i), x.cur) { if v != 0 { paid[keyOf[n]!] = v } } else { broken = true } }
            for (n, i) in forr { if let v = sheetAmount(cell(r, i), x.cur) { if v != 0 { owed[keyOf[n]!] = v } } else { broken = true } }
            if broken { b.bad.append(line); continue }
            let cost = cm.iAmt >= 0 ? sheetAmount(cell(r, cm.iAmt), x.cur) : nil
            let pay = x.pay || (owed.count == 1 && paid.count == 1 && paid.keys.first != owed.keys.first && test(paymentDesc, x.t))
            b.add(Row(line: line, d: x.d!, t: x.t, cat: x.cat, cur: x.cur, cost: cost, pay: pay, paid: paid, owed: owed))
        }
        return finish(b, people, .paidfor, c.fileName, [:])
    }

    /// "Who paid" with a share column per person (Settle Up), or with "For whom" names (Splid,
    /// spreadsheets, and the columns someone picked)
    private static func payerLayouts(_ c: Ctx) -> Result? {
        let iPayer = col(c.head, payerHead)
        guard iPayer >= 0 else { return nil }
        let cm = common(c)
        guard cm.iDate >= 0, cm.iAmt >= 0 else { return nil }
        let iFor = col(c.head, forHead)
        let rows = dataRows(c).filter { !isTotalRow($0.r, cm.iDate, cm.iDesc) }
        let payerNames = Set(rows.map { cell($0.r, iPayer).lowercased() }.filter { !$0.isEmpty })
        let known: Set<Int> = [iPayer, iFor, cm.iDate, cm.iDesc, cm.iAmt, col(c.head, catHead), col(c.head, curHead), col(c.head, typeHead)]
        let numeric = c.head.enumerated().map { (h: cut($0.element), i: $0.offset) }.filter { m in
            !known.contains(m.i) && !m.h.isEmpty && !test(notAPerson, m.h) && rows.allSatisfy { sheetAmount(cell($0.r, m.i), "EUR") != nil }
        }
        let memberCols = numeric.filter { payerNames.contains($0.h.lowercased()) }.count >= 2 ? numeric : []
        let layout: Layout = memberCols.count >= 2 ? .shares : .list
        var names: [String] = [], display: [String: String] = [:]
        func meet(_ n: String) { let k = n.lowercased(); if k.isEmpty || test(everyone, k) || display[k] != nil { return }; display[k] = n; names.append(k) }
        if layout == .shares { memberCols.forEach { meet($0.h) } }
        for (r, _) in rows {
            meet(cell(r, iPayer))
            if layout == .list && iFor >= 0 { self.names(in: cell(r, iFor)).forEach(meet) }
        }
        guard names.count >= 2, names.count <= maxPeople else { return nil }
        let people = names.enumerated().map { Person(key: String($0.offset), name: display[$0.element]!) }
        let keyOf = Dictionary(uniqueKeysWithValues: names.enumerated().map { ($0.element, String($0.offset)) })
        let keys = people.map(\.key)
        let b = Book(keys)
        for (r, line) in rows {
            let x = cm.base(r, line)
            guard let d = x.d, isCode(x.cur), let total = sheetAmount(cell(r, cm.iAmt), x.cur), let payer = keyOf[cell(r, iPayer).lowercased()] else {
                b.bad.append(line); continue
            }
            var owed: [String: Int] = [:]
            let sign = total < 0 ? -1 : 1
            if layout == .shares {
                var broken = false
                for m in memberCols { if let v = sheetAmount(cell(r, m.i), x.cur) { if v != 0 { owed[keyOf[m.h.lowercased()]!] = v } } else { broken = true } }
                if broken { b.bad.append(line); continue }
                if owed.isEmpty { for (k, v) in equalParts(abs(total), keys) where v != 0 { owed[k] = sign * v } }
            } else {
                let named = iFor >= 0 ? self.names(in: cell(r, iFor)) : []
                let among: [String?] = !named.isEmpty && !named.contains(where: { test(everyone, $0) }) ? named.map { keyOf[$0.lowercased()] } : keys
                if among.contains(where: { $0 == nil }) { b.bad.append(line); continue }
                let uniq = Array(Set(among.map { $0! })).sorted { Int($0)! < Int($1)! }
                for (k, v) in equalParts(abs(total), uniq) where v != 0 { owed[k] = sign * v }
            }
            let pay = x.pay || (owed.count == 1 && owed[payer] == nil && test(paymentDesc, x.t))
            b.add(Row(line: line, d: d, t: x.t, cat: x.cat, cur: x.cur, cost: total, pay: pay, paid: [payer: total], owed: owed))
        }
        return finish(b, people, layout, c.fileName, [:])
    }

    /// "which column is what?": the columns someone picked, read as a "who paid / for whom" list
    private static func mappedLayout(_ c: Ctx, _ map: ColumnMap) -> Result {
        var head = c.head.map { _ in "" }
        func set(_ i: Int, _ v: String) { if i >= 0 && i < head.count { head[i] = v } }
        set(map.date, "date"); set(map.amount, "amount"); set(map.payer, "paid by")
        set(map.description, "description"); set(map.forWhom, "for whom"); set(map.currency, "currency"); set(map.category, "category")
        var cc = c
        cc.head = head
        return payerLayouts(cc) ?? .notRecognised(header: c.head, sample: Array(dataRows(c).prefix(3).map(\.r)))
    }

    /// one sheet or CSV: find its header row (one of the first ten), then its layout
    static func table(_ rows: [[String]], fileName: String = "", currency: String = "EUR", map: ColumnMap? = nil) -> Result {
        let nonEmpty = rows.enumerated().filter { $0.element.contains { !cut($0).isEmpty } }.map(\.offset)
        guard let firstRow = nonEmpty.first else { return .empty }
        let fallback = currency.uppercased()
        let headOf = { (i: Int) in rows[i].map(cut) }
        if let map { return mappedLayout(Ctx(rows: rows, hi: firstRow, head: headOf(firstRow), fallback: fallback, fileName: fileName), map) }
        for i in nonEmpty.prefix(10) {
            let c = Ctx(rows: rows, hi: i, head: headOf(i), fallback: fallback, fileName: fileName)
            for layout in [paidForLayout, payerLayouts, netLayout] {
                guard let res = layout(c) else { continue }
                switch res { case .ok, .tooLarge: return res; default: continue }
            }
        }
        let c = Ctx(rows: rows, hi: firstRow, head: headOf(firstRow), fallback: fallback, fileName: fileName)
        if nonEmpty.count == 1 || dataRows(c).isEmpty { return .empty }
        return .notRecognised(header: c.head, sample: Array(dataRows(c).prefix(3).map(\.r)))
    }

    /// a workbook: the sheet that reads best (most rows taken in)
    static func sheets(_ sheets: [[[String]]], fileName: String = "", currency: String = "EUR") -> Result {
        var best: File?, fallback: Result?
        for s in sheets {
            let r = table(s, fileName: fileName, currency: currency)
            switch r {
            case .ok(let f): if best == nil || f.expenses.count + f.payments.count > best!.expenses.count + best!.payments.count { best = f }
            case .tooLarge: return r
            case .notRecognised(_, let sample):
                if case .notRecognised(_, let fs)? = fallback, sample.count <= fs.count { break }
                fallback = r
            case .empty: if fallback == nil { fallback = r }
            }
        }
        if let best { return .ok(best) }
        return fallback ?? .empty
    }

    static func csv(_ text: String, fileName: String = "", currency: String = "EUR", map: ColumnMap? = nil) -> Result {
        table(csvTable(text), fileName: fileName, currency: currency, map: map)
    }

    /// which column is you: your name (or its first word) as the file wrote it
    static func guessMe(_ people: [Person], _ myName: String) -> String? {
        let n = myName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !n.isEmpty else { return nil }
        if let p = people.first(where: { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == n }) { return p.key }
        let firstWord = n.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? n
        let hits = people.filter { ($0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "") == firstWord }
        return hits.count == 1 ? hits[0].key : nil
    }

    /// "42 expenses and 3 payments"
    static func summary(_ f: File) -> String {
        func n(_ k: Int, _ one: String) -> String { "\(k) \(one)\(k == 1 ? "" : "s")" }
        return [f.expenses.isEmpty ? "" : n(f.expenses.count, "expense"), f.payments.isEmpty ? "" : n(f.payments.count, "payment")]
            .filter { !$0.isEmpty }.joined(separator: " and ")
    }
}
