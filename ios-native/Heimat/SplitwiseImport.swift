import Foundation

/// Bringing a group over from Splitwise (Group → Settings → Export as spreadsheet): one row per
/// expense or payment — Date, Description, Category, Cost, Currency, then one column per person
/// holding what they paid minus what they owed. Each row is rebuilt as who paid and who owes so
/// that every balance comes out exactly as in Splitwise; the server (import_group) refuses the
/// import otherwise. The rules are written out in src/lib/importSplitwise.ts; this is the same,
/// held to tests/splitwise-import-vectors.json.
enum SplitwiseImport {
    struct Person: Equatable, Encodable { var key: String; var name: String }
    struct Expense: Equatable, Encodable {
        var d: String; var t: String; var c: String; var cur: String; var total: Int
        var paid: [String: Int]; var owed: [String: Int]
    }
    struct Payment: Equatable, Encodable { var d: String; var t: String; var from: String; var to: String; var cur: String; var total: Int }
    enum Totals: String { case yes, rounding, no, none }
    struct File: Equatable {
        var name: String
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
    enum Failure: String, Error { case notSplitwise = "not_splitwise", empty, tooLarge = "too_large" }

    static let maxRows = 5000
    static let maxPeople = 49

    private static func groups(_ pattern: String, _ s: String, _ opts: NSRegularExpression.Options = []) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: opts),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }
    private static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    private static let category: [(String, String)] = [
        ("^(rent|mortgage)$", "rent"),
        ("^(groceries|liquor)$", "groceries"),
        ("^(electricity|heat/gas|water|utilities - other|trash|cleaning)$", "utilities"),
        ("^(tv/phone/internet)$", "internet"),
        ("^(dining out|food and drink - other)$", "eatout"),
        ("^(bus/train|car|gas/fuel|parking|plane|taxi|transportation - other|bicycle)$", "transport"),
        ("^(household supplies|furniture|maintenance|home - other|electronics|pets|services)$", "household"),
    ]
    static func categoryOf(_ splitwise: String, _ description: String) -> String {
        let s = trim(splitwise).lowercased()
        for (re, c) in category where groups(re, s) != nil { return c }
        return Suggest.builtin(description) ?? "other"
    }
    private static let payment = "^(payment|zahlung|pago|paiement|pagamento|betaling|płatność)$"
    private static let total = "^(total balance|gesamtsaldo|saldo total|solde total|saldo totale|totaal saldo|total)$"

    private static func splitCsv(_ text: String, _ sep: Unicode.Scalar) -> [[String]] {
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

    private static func validDate(_ y: Int, _ m: Int, _ d: Int) -> String? {
        guard (2000...2100).contains(y), (1...12).contains(m), d >= 1 else { return nil }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        guard d <= days else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }
    /// "2024-01-31", "2024-01-31 18:20:00", "31.01.2024", "31/01/2024"
    static func date(_ s: String) -> String? {
        let t = trim(s)
        if let g = groups("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:[T ].*)?$", t) { return validDate(Int(g[1])!, Int(g[2])!, Int(g[3])!) }
        if let g = groups("^([0-9]{1,2})[./]([0-9]{1,2})[./]([0-9]{4})$", t) { return validDate(Int(g[3])!, Int(g[2])!, Int(g[1])!) }
        return nil
    }
    /// minor units; zeros beyond what the currency has are dropped first ("1000.00" yen)
    static func amount(_ s: String, _ cur: String) -> Int? {
        var t = trim(s)
        let dg = Money.digits(cur)
        if let g = groups("^([-\u{2212}]?[0-9]+)[.,]([0-9]+)$", t), g[2].count > dg, g[2].dropFirst(dg).allSatisfy({ $0 == "0" }) {
            let keep = String(g[2].prefix(dg))
            t = keep.isEmpty ? g[1] : "\(g[1]).\(keep)"
        }
        return Money.parse(t, cur)
    }
    /// "wg-berlin_2024-05-03_export.csv" → "Wg berlin"
    static func name(fromFile file: String) -> String {
        var s = file
        for (re, with) in [("\\.[a-z0-9]+$", ""), ("[_ -]*[0-9]{4}-[0-9]{2}-[0-9]{2}[_ -]*export$", ""), ("[_-]+", " "), ("\\s+", " ")] {
            s = (try? NSRegularExpression(pattern: re, options: .caseInsensitive))
                .map { $0.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: with) } ?? s
        }
        s = trim(s)
        guard !s.isEmpty, s.lowercased() != "export" else { return "" }
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// `r` split equally among `keys` in that order; the first ones get the odd cents
    private static func equalParts(_ r: Int, _ keys: [String]) -> [String: Int] {
        var out: [String: Int] = [:]
        let base = Int((Double(r) / Double(keys.count)).rounded(.down))
        var left = r - base * keys.count
        for k in keys { out[k] = base + (left > 0 ? 1 : 0); if left > 0 { left -= 1 } }
        return out
    }
    /// the first `n` UTF-16 units, as the web app's slice
    private static func clip(_ s: String, _ n: Int) -> String {
        s.utf16.count <= n ? s : String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
    }

    static func run(_ text: String, fileName: String = "") -> Result<File, Failure> {
        var clean = text
        if clean.hasPrefix("\u{FEFF}") { clean.removeFirst() }
        var first = String(clean.unicodeScalars.prefix { $0 != "\n" })
        if first.hasSuffix("\r") { first.removeLast() }
        func count(_ c: Unicode.Scalar) -> Int { first.unicodeScalars.filter { $0 == c }.count }
        let sep: Unicode.Scalar = count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ","
        let rows = splitCsv(clean, sep)
        guard let hi = rows.firstIndex(where: { $0.contains { !trim($0).isEmpty } }) else { return .failure(.empty) }
        let head = rows[hi].map(trim)
        var last = head.count
        while last > 5 && head[last - 1].isEmpty { last -= 1 }
        guard last >= 7, last - 5 <= maxPeople else { return .failure(.notSplitwise) }
        let people = head[5..<last].enumerated().map { Person(key: String($0.offset), name: $0.element.isEmpty ? "Person \($0.offset + 1)" : $0.element) }
        let keys = people.map(\.key)

        var expenses: [Expense] = [], payments: [Payment] = [], bad: [Int] = []
        var balances: [String: Int] = [:], totals: [String: Int] = [:]
        var skipped = 0, from: String?, to: String?

        for i in (hi + 1)..<rows.count {
            let r = rows[i].map(trim)
            guard r.contains(where: { !$0.isEmpty }) else { continue }
            func at(_ j: Int) -> String { j < r.count ? r[j] : "" }
            let line = i + 1
            let cur = at(4).uppercased()
            let nets = keys.indices.map { j in amount(at(5 + j).isEmpty ? "0" : at(5 + j), cur) }
            if date(at(0)) == nil && groups(total, at(1), .caseInsensitive) != nil {
                if groups("^[A-Z]{3}$", cur) != nil && nets.allSatisfy({ $0 != nil }) {
                    for (j, k) in keys.enumerated() { totals["\(k)|\(cur)", default: 0] += nets[j]! }
                }
                continue
            }
            guard let d = date(at(0)), groups("^[A-Z]{3}$", cur) != nil, let cost = amount(at(3), cur),
                  nets.allSatisfy({ $0 != nil }) else { bad.append(line); continue }
            let net = nets.map { $0! }
            guard net.reduce(0, +) == 0 else { bad.append(line); continue }
            let up = keys.indices.filter { net[$0] > 0 }.map { keys[$0] }
            let down = keys.indices.filter { net[$0] < 0 }.map { keys[$0] }
            func nk(_ k: String) -> Int { net[Int(k)!] }
            let sumUp = up.reduce(0) { $0 + nk($1) }
            if up.isEmpty { skipped += 1; continue }
            if expenses.count + payments.count >= maxRows { return .failure(.tooLarge) }
            if from == nil || d < from! { from = d }
            if to == nil || d > to! { to = d }
            for k in keys where nk(k) != 0 { balances["\(k)|\(cur)", default: 0] += nk(k) }

            let desc = clip(at(1), 200)
            if groups(payment, at(2), .caseInsensitive) != nil && up.count == 1 && down.count == 1 {
                payments.append(Payment(d: d, t: desc, from: up[0], to: down[0], cur: cur, total: sumUp))
                continue
            }
            let total = cost >= sumUp && cost > 0 ? cost : sumUp
            var owed: [String: Int] = [:], paid: [String: Int] = [:]
            for k in down { owed[k] = -nk(k) }
            let mine = equalParts(total - sumUp, up)
            for k in up {
                if mine[k]! != 0 { owed[k] = mine[k]! }
                paid[k] = nk(k) + mine[k]!
            }
            expenses.append(Expense(d: d, t: desc, c: categoryOf(at(2), desc), cur: cur, total: total, paid: paid, owed: owed))
        }
        if expenses.isEmpty && payments.isEmpty { return .failure(bad.isEmpty ? .empty : .notSplitwise) }

        let bal = balances.filter { $0.value != 0 }
        var state = Totals.none
        if !totals.isEmpty {
            let ids = Set(bal.keys).union(totals.filter { $0.value != 0 }.keys)
            let worst = ids.map { abs((bal[$0] ?? 0) - (totals[$0] ?? 0)) }.max() ?? 0
            state = worst == 0 ? .yes : worst <= 5 ? .rounding : .no
        }
        let currencies = Array(Set(expenses.map(\.cur) + payments.map(\.cur))).sorted()
        return .success(File(name: name(fromFile: fileName), people: people, expenses: expenses, payments: payments, balances: bal,
                             totals: state, skipped: skipped, bad: bad, from: from, to: to, currencies: currencies))
    }

    /// which column is you: your name (or its first word) as Splitwise wrote it
    static func guessMe(_ people: [Person], _ myName: String) -> String? {
        let n = trim(myName).lowercased()
        guard !n.isEmpty else { return nil }
        if let p = people.first(where: { trim($0.name).lowercased() == n }) { return p.key }
        let firstWord = n.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? n
        let hits = people.filter { (trim($0.name).lowercased().split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "") == firstWord }
        return hits.count == 1 ? hits[0].key : nil
    }

    /// "42 expenses and 3 payments"
    static func summary(_ f: File) -> String {
        func n(_ k: Int, _ one: String) -> String { "\(k) \(one)\(k == 1 ? "" : "s")" }
        return [f.expenses.isEmpty ? "" : n(f.expenses.count, "expense"), f.payments.isEmpty ? "" : n(f.payments.count, "payment")]
            .filter { !$0.isEmpty }.joined(separator: " and ")
    }
}
