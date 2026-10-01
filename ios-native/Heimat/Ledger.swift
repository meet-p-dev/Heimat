import Foundation

// Heimat's money engine — the same rules as src/lib/ledger.ts, line for line,
// held to the same answers by tests/ledger-vectors.json
// (ios-native/Tests/LedgerTests.swift). Change one, change both, and
// regenerate the vectors with `npm run vectors`.
//
// Every amount is a whole number of the currency's smallest unit — cents for
// euros — never a binary fraction. An expense becomes whole-cent shares that
// add up to exactly its total, and every figure the app shows (a share, a
// balance, who owes whom, the settle-up plan) is a sum of those same shares,
// so no two figures can disagree and a flat's balances add up to exactly zero.
//
// Foundation only, so the tests compile with plain swiftc.

protocol LedgerExpense {
    var id: String { get }
    var amount: Double { get }
    var currency: String { get }
    var paidBy: String { get }
    var splitAmong: [String] { get }
    // engine v2 — see SplitData; all optional, rows from before it are equal splits
    var splitType: String? { get }
    var split: SplitData? { get }
    /// minor units each person paid, when more than one did
    var payers: [String: Double]? { get }
    /// minor units each person owes, as stored by the database — authoritative
    var storedShares: [String: Double]? { get }
    var deletedAt: String? { get }
}

extension LedgerExpense {
    var splitType: String? { nil }
    var split: SplitData? { nil }
    var payers: [String: Double]? { nil }
    var storedShares: [String: Double]? { nil }
    var deletedAt: String? { nil }
}

protocol LedgerSettlement {
    var fromUser: String { get }
    var toUser: String { get }
    var amount: Double { get }
    /// nil on rows from before currencies were recorded: the flat's own currency
    var currency: String? { get }
}

extension LedgerSettlement {
    var currency: String? { nil }
}

/// The inputs of a split, as the database stores them in expenses.split:
/// exact — minor units per person; percent — basis points (10000 = 100 %);
/// shares — a weight per person, up to two decimals; adjust — ± minor units on
/// top of an equal split of the rest; itemized — receipt lines, tax, tip, discount.
/// Read leniently: one odd field (from a newer app, say) must never stop a flat's
/// expenses from loading — a split that can't be read is refused by computeShares,
/// and the stored shares are used instead.
struct SplitData: Codable, Hashable {
    struct Item: Codable, Hashable {
        var label: String?; var minor: Double; var among: [String]
        init(label: String? = nil, minor: Double, among: [String]) { self.label = label; self.minor = minor; self.among = among }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = try? c.decodeIfPresent(String.self, forKey: .label)
            minor = (try? c.decodeIfPresent(Double.self, forKey: .minor)) ?? .nan
            among = (try? c.decodeIfPresent([String].self, forKey: .among)) ?? []
        }
    }
    var values: [String: Double]?
    var items: [Item]?
    var tax: Double?, tip: Double?, discount: Double?
    init(values: [String: Double]? = nil, items: [Item]? = nil, tax: Double? = nil, tip: Double? = nil, discount: Double? = nil) {
        self.values = values; self.items = items; self.tax = tax; self.tip = tip; self.discount = discount
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        values = try? c.decodeIfPresent([String: Double].self, forKey: .values)
        items = try? c.decodeIfPresent([Item].self, forKey: .items)
        tax = try? c.decodeIfPresent(Double.self, forKey: .tax)
        tip = try? c.decodeIfPresent(Double.self, forKey: .tip)
        discount = try? c.decodeIfPresent(Double.self, forKey: .discount)
    }
}

// MARK: - Amounts

enum Money {
    /// ISO 4217 minor-unit exponents that are not 2
    private static let exponents: [String: Int] = [
        "BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0, "KRW": 0, "PYG": 0,
        "RWF": 0, "UGX": 0, "UYI": 0, "VND": 0, "VUV": 0, "XAF": 0, "XOF": 0, "XPF": 0,
        "BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
    ]
    private static let scale = [1, 10, 100, 1000]

    static func digits(_ cur: String?) -> Int { exponents[(cur ?? "").uppercased()] ?? 2 }

    /// 12.5 EUR → 1250; nil for anything not finite. Shifts the decimal point
    /// in the number's shortest decimal form ("1.005" → "100.5") rather than
    /// multiplying in binary, where 1.005 × 100 is 100.49999…, then rounds half
    /// away from zero — exactly what the TypeScript does.
    static func toMinor(_ major: Double, _ cur: String?) -> Int? {
        guard major.isFinite else { return nil }
        let d = digits(cur), a = abs(major), s = "\(a)"
        let shifted = s.contains("e") ? a * Double(scale[d]) : (Double(s + "e\(d)") ?? a * Double(scale[d]))
        let v = shifted.rounded(.toNearestOrAwayFromZero)
        guard v < 9_007_199_254_740_992 else { return nil }
        let i = Int(v)
        return major < 0 ? -i : i
    }

    /// 1250 → 12.5: the double nearest the exact decimal, so formatting it never
    /// lands on a half-cent and the web and this app print the same digits.
    static func toMajor(_ minor: Int, _ cur: String?) -> Double { Double(minor) / Double(scale[digits(cur)]) }

    /// What someone typed, as minor units — or nil if it is not an amount.
    ///
    /// Both conventions come back in: "1.234,56", "1,234.56", "12,5", "12.50",
    /// "1 200", "1'200.50". With both separators present the later one is the
    /// decimal point. A lone separator followed by exactly three digits is a
    /// thousands separator when the currency has fewer than three decimals —
    /// "1.200" is twelve hundred euros, not one euro twenty. More decimals than
    /// the currency has is refused rather than silently rounded.
    static func parse(_ input: String, _ cur: String?) -> Int? {
        let d = digits(cur)
        var s = String(input.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) && $0 != "\u{00A0}" && $0 != "\u{202F}" && $0 != "'" && $0 != "\u{2019}" })
        var sign = 1
        if s.hasPrefix("-") || s.hasPrefix("\u{2212}") { sign = -1; s.removeFirst() } else if s.hasPrefix("+") { s.removeFirst() }
        guard !s.isEmpty, s.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == "." || $0 == ",") }), s.contains(where: \.isNumber) else { return nil }

        let dots = s.filter { $0 == "." }.count, commas = s.filter { $0 == "," }.count
        var intPart: String, frac = ""
        if dots > 0 && commas > 0 {
            let dec: Character = s.lastIndex(of: ".")! > s.lastIndex(of: ",")! ? "." : ","
            let grp: Character = dec == "." ? "," : "."
            guard s.filter({ $0 == dec }).count == 1, let at = s.lastIndex(of: dec) else { return nil }
            intPart = String(s[..<at]); frac = String(s[s.index(after: at)...])
            guard groupedOK(intPart, grp) else { return nil }
            intPart.removeAll { $0 == grp }
        } else if dots + commas > 1 {
            let grp: Character = dots > 0 ? "." : ","
            guard groupedOK(s, grp) else { return nil }
            intPart = s.filter { $0 != grp }
        } else if dots + commas == 1 {
            let at = s.firstIndex { $0 == "." || $0 == "," }!
            let before = String(s[..<at]), after = String(s[s.index(after: at)...])
            if after.count == 3 && d < 3 && (1...3).contains(before.count) && before.first != "0" && after.allSatisfy(\.isNumber) {
                intPart = before + after
            } else { intPart = before; frac = after }
        } else { intPart = s }

        guard intPart.allSatisfy(\.isNumber), frac.allSatisfy(\.isNumber), frac.count <= d else { return nil }
        guard intPart.drop(while: { $0 == "0" }).count <= 13 else { return nil }
        let whole = Int(intPart) ?? 0
        let part = Int(frac.padding(toLength: d, withPad: "0", startingAt: 0)) ?? 0
        let v = whole * scale[d] + part
        return v == 0 ? 0 : sign * v
    }

    /// "1.234.567": first group 1-3 digits, every later group exactly 3
    private static func groupedOK(_ s: String, _ grp: Character) -> Bool {
        let g = s.split(separator: grp, omittingEmptySubsequences: false)
        guard let first = g.first, (1...3).contains(first.count), first.allSatisfy(\.isNumber) else { return false }
        return g.dropFirst().allSatisfy { $0.count == 3 && $0.allSatisfy(\.isNumber) }
    }

    /// 1250 → "12,50", for pre-filling a field the user may then edit
    static func input(_ minor: Int, _ cur: String?) -> String {
        let d = digits(cur), a = abs(minor), whole = a / scale[d], rest = a % scale[d]
        let frac = d > 0 ? "," + String(repeating: "0", count: max(0, d - String(rest).count)) + String(rest) : ""
        return (minor < 0 ? "-" : "") + String(whole) + frac
    }
}

// MARK: - Ledger

enum Ledger {
    /// JavaScript's `<` on strings compares UTF-16 code units; so does this, so
    /// every tie in the two apps breaks the same way.
    static func less(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

    /// 32-bit FNV-1a over the UTF-8 bytes — a few lines here, in TypeScript and in SQL, with one answer.
    static func fnv1a(_ s: String) -> UInt32 {
        var h: UInt32 = 0x811C9DC5
        for b in s.utf8 { h = (h ^ UInt32(b)) &* 0x0100_0193 }
        return h
    }

    /// Split `total` minor units in proportion to integer `weights`, adding up to
    /// exactly `total` — largest remainder (Hamilton). Everyone gets
    /// floor(total × weight ÷ Σweights); the leftover units go to the largest
    /// remainders, a tie to whoever sorts first by fnv1a(seed + ":" + person),
    /// then by id. Duplicate people add their weights, zero weights take no part,
    /// a negative total splits with the sign flipped. Int128, so no product of
    /// amount and weight can overflow. Line for line src/lib/ledger.ts.
    static func allocateWeighted(_ total: Int, _ weights: [(String, Int)], seed: String) -> [String: Int] {
        var w: [String: Int128] = [:]
        for (u, x) in weights where !u.isEmpty {
            guard x >= 0 else { return [:] }
            if x != 0 { w[u, default: 0] += Int128(x) }
        }
        guard !w.isEmpty else { return [:] }
        let W = w.values.reduce(0, +), T = Int128(abs(total))
        var rows = w.map { u, v in (u: u, base: T * v / W, rem: T * v % W, k: fnv1a(seed + ":" + u)) }
        var extra = T - rows.reduce(0) { $0 + $1.base }
        rows.sort { $0.rem != $1.rem ? $0.rem > $1.rem : $0.k != $1.k ? $0.k < $1.k : less($0.u, $1.u) }
        var out: [String: Int] = [:]
        for r in rows {
            var v = r.base
            if extra > 0 { v += 1; extra -= 1 }
            let n = Int(v)
            out[r.u] = total < 0 ? -n : n
        }
        return out
    }

    /// an equal split: the weighted split with everyone weighing 1
    static func allocate(_ total: Int, _ people: [String], seed: String) -> [String: Int] {
        var seen = Set<String>(), who: [(String, Int)] = []
        for p in people where !p.isEmpty && seen.insert(p).inserted { who.append((p, 1)) }
        return allocateWeighted(total, who, seed: seed)
    }

    // MARK: splits

    /// no single bill is larger than this many minor units (a billion euros)
    static let maxMinor = 100_000_000_000

    enum SplitError: Equatable {
        case empty, tooLarge, unknownType
        case badValue(who: String?)
        case sumMismatch(diff: Int)          // short (−) or over (+) by this many minor units
        case percentTotal(diff: Int)         // off 100 % by this many basis points
        case remainderNegative(diff: Int)    // adjustments add up to more than the bill
        case notInSplit(who: String)
    }

    enum SplitResult: Equatable { case ok([String: Int]), failed(SplitError) }

    struct SplitSpec {
        var type: String
        var among: [String] = []
        var values: [String: Double] = [:]
        var items: [SplitData.Item] = []
        var tax: Double? = nil, tip: Double? = nil, discount: Double? = nil
    }

    private static func sortedEntries(_ r: [String: Double]) -> [(String, Double)] {
        r.filter { !$0.key.isEmpty }.map { ($0.key, $0.value) }.sorted { less($0.0, $1.0) }
    }
    private static func int(_ v: Double?) -> Int? {
        guard let v, v.isFinite, v.rounded() == v, abs(v) < 9_007_199_254_740_992 else { return nil }
        return Int(v)
    }
    /// a share weight like 1.5 → 150; nil if it has more than two decimals or is out of range —
    /// read from the shortest decimal form, as Postgres and the TypeScript read it
    private static func weight100(_ v: Double) -> Int? {
        guard v.isFinite, v >= 0, v <= 10_000 else { return nil }
        let parts = "\(v)".split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let whole = Int(parts[0]), parts.count == 1 || parts[1].count <= 2 else { return nil }
        let frac = parts.count == 2 ? Int(parts[1].padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
        return whole * 100 + frac
    }
    private static func dedupe(_ xs: [String]) -> [String] {
        var seen = Set<String>(); return xs.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// What each person owes for one bill of `total` minor units, split as `spec`
    /// says — always whole units adding up to exactly `total`, or why it cannot
    /// be split that way. See computeShares in src/lib/ledger.ts for each type.
    static func computeShares(_ total: Int, _ spec: SplitSpec, seed: String) -> SplitResult {
        guard abs(total) <= maxMinor else { return .failed(.tooLarge) }
        let sign = total < 0 ? -1 : 1
        switch spec.type {
        case "equal":
            let who = dedupe(spec.among)
            guard !who.isEmpty else { return .failed(.empty) }
            return .ok(allocate(total, who, seed: seed))
        case "exact":
            let vals = sortedEntries(spec.values)
            guard !vals.isEmpty else { return .failed(.empty) }
            var out: [String: Int] = [:], sum = 0
            for (u, x) in vals {
                guard let v = int(x), v * sign >= 0 else { return .failed(.badValue(who: u)) }
                if v != 0 { out[u] = v }
                sum += v
            }
            guard sum == total else { return .failed(.sumMismatch(diff: sum - total)) }
            if out.isEmpty { return total == 0 ? .ok(out) : .failed(.empty) }
            return .ok(out)
        case "percent":
            let vals = sortedEntries(spec.values)
            guard !vals.isEmpty else { return .failed(.empty) }
            var ws: [(String, Int)] = [], bp = 0
            for (u, x) in vals {
                guard let v = int(x), v >= 0, v <= 10_000 else { return .failed(.badValue(who: u)) }
                ws.append((u, v)); bp += v
            }
            guard bp == 10_000 else { return .failed(.percentTotal(diff: bp - 10_000)) }
            return .ok(allocateWeighted(total, ws, seed: seed))
        case "shares":
            var ws: [(String, Int)] = []
            for (u, x) in sortedEntries(spec.values) {
                guard let w = weight100(x) else { return .failed(.badValue(who: u)) }
                if w != 0 { ws.append((u, w)) }
            }
            guard !ws.isEmpty else { return .failed(.empty) }
            return .ok(allocateWeighted(total, ws, seed: seed))
        case "adjust":
            let who = dedupe(spec.among)
            guard !who.isEmpty else { return .failed(.empty) }
            var adj = 0, adjs: [(String, Int)] = []
            for (u, x) in sortedEntries(spec.values) {
                guard let v = int(x), abs(v) <= maxMinor else { return .failed(.badValue(who: u)) }
                if v != 0 && !who.contains(u) { return .failed(.notInSplit(who: u)) }
                adj += v; adjs.append((u, v))
            }
            let rest = total - adj
            guard rest * sign >= 0 else { return .failed(.remainderNegative(diff: -rest * sign)) }
            var out = allocate(rest, who, seed: seed)
            for (u, v) in adjs where v != 0 { out[u, default: 0] += v }
            return .ok(out)
        case "itemized":
            guard !spec.items.isEmpty else { return .failed(.empty) }
            guard let tax = int(spec.tax ?? 0), let tip = int(spec.tip ?? 0), let discount = int(spec.discount ?? 0),
                  (0...maxMinor).contains(tax), (0...maxMinor).contains(tip), (0...maxMinor).contains(discount)
            else { return .failed(.badValue(who: nil)) }
            var sub: [String: Int] = [:], itemsTotal = 0
            for (i, it) in spec.items.enumerated() {
                let who = dedupe(it.among)
                guard let m = int(it.minor), (0...maxMinor).contains(m) else { return .failed(.badValue(who: nil)) }
                guard !who.isEmpty else { return .failed(.empty) }
                itemsTotal += m
                for (u, v) in allocate(m, who, seed: "\(seed):item:\(i)") { sub[u, default: 0] += v }
            }
            let expected = (itemsTotal + tax + tip - discount) * sign
            guard expected == total else { return .failed(.sumMismatch(diff: expected - total)) }
            let extra = (tax + tip - discount) * sign
            let ws = sub.filter { $0.value > 0 }.map { ($0.key, $0.value) }.sorted { less($0.0, $1.0) }
            if extra != 0 && ws.isEmpty { return .failed(.empty) }
            var out = sub.mapValues { $0 * sign }
            for (u, v) in allocateWeighted(extra, ws, seed: "\(seed):extra") { out[u, default: 0] += v }
            return .ok(out)
        default:
            return .failed(.unknownType)
        }
    }

    /// who paid how much: `payers` when more than one person did (they must add up to the bill), else the payer alone
    static func computePaid(_ total: Int, _ payers: [String: Double]?, paidBy: String) -> SplitResult {
        let vals = sortedEntries(payers ?? [:])
        guard !vals.isEmpty else { return paidBy.isEmpty ? .failed(.empty) : .ok([paidBy: total]) }
        let sign = total < 0 ? -1 : 1
        var out: [String: Int] = [:], sum = 0
        for (u, x) in vals {
            guard let v = int(x), v * sign >= 0 else { return .failed(.badValue(who: u)) }
            if v != 0 { out[u] = v }
            sum += v
        }
        guard sum == total else { return .failed(.sumMismatch(diff: sum - total)) }
        return .ok(out)
    }

    /// the split an expense row describes; rows from before engine v2 are equal splits
    static func spec(_ e: some LedgerExpense) -> SplitSpec {
        let type = e.splitType ?? "equal", d = e.split
        if type == "itemized" { return SplitSpec(type: type, items: d?.items ?? [], tax: d?.tax, tip: d?.tip, discount: d?.discount) }
        return SplitSpec(type: type, among: participants(e), values: d?.values ?? [:])
    }

    // MARK: postings

    /// everyone the bill is split between; an empty split means the payer alone
    static func participants(_ e: some LedgerExpense) -> [String] {
        guard !e.splitAmong.isEmpty else { return [e.paidBy] }
        var seen = Set<String>()
        return e.splitAmong.filter { seen.insert($0).inserted }
    }

    struct Postings { let currency: String; let total: Int; let paid: [String: Int]; let owed: [String: Int] }

    /// One expense as postings: what each person paid and what each owes. The
    /// database's stored shares win when they add up to the bill — they are the
    /// record; otherwise they are worked out from the split. Nil when unreadable.
    static func postings(_ e: some LedgerExpense, currency cur: String? = nil) -> Postings? {
        let currency = e.currency.isEmpty ? (cur ?? "EUR") : e.currency
        guard let total = Money.toMinor(e.amount, currency), !e.paidBy.isEmpty else { return nil }
        guard case .ok(let paid) = computePaid(total, e.payers, paidBy: e.paidBy) else { return nil }
        var owed: [String: Int]?
        if let stored = e.storedShares {
            var m: [String: Int] = [:], sum = 0, fine = true
            for (u, x) in stored { guard let v = int(x) else { fine = false; break }; if v != 0 { m[u] = v }; sum += v }
            if fine && sum == total && (!m.isEmpty || total == 0) { owed = m }
        }
        if owed == nil {
            guard case .ok(let s) = computeShares(total, spec(e), seed: e.id) else { return nil }
            owed = s
        }
        return Postings(currency: currency, total: total, paid: paid, owed: owed!)
    }

    /// each participant's share of one expense, in minor units: the order the expense lists them, then anyone else
    static func shares(_ e: some LedgerExpense) -> [(uid: String, minor: Int)] {
        guard let p = postings(e) else { return [] }
        let listed = participants(e).filter { p.owed[$0] != nil }
        let rest = p.owed.keys.filter { !listed.contains($0) }.sorted(by: less)
        return (listed + rest).map { ($0, p.owed[$0] ?? 0) }
    }

    /// one person's share of one expense, in major units; 0 if they are not in it
    static func share(_ e: some LedgerExpense, of uid: String?) -> Double {
        guard let uid, let s = shares(e).first(where: { $0.uid == uid }) else { return 0 }
        return Money.toMajor(s.minor, e.currency)
    }

    /// a person's total share across expenses — their spending — summed in minor units, of one
    /// currency when given (the flat's main one): minor units of two currencies never add up
    static func myShareMinor(_ expenses: [some LedgerExpense], uid: String?, currency: String? = nil) -> Int {
        guard let uid else { return 0 }
        return expenses.reduce(0) { t, e in
            guard currency == nil || (e.currency.isEmpty ? currency! : e.currency) == currency else { return t }
            return t + (postings(e)?.owed[uid] ?? 0)
        }
    }

    /// Who owes whom for one expense: everyone down owes the people up, in
    /// proportion to how far up each is. Debtors in id order, each split over
    /// what the creditors are still owed, so every creditor ends exactly square.
    static func debts(_ p: Postings, seed: String) -> [(from: String, to: String, minor: Int)] {
        let people = Set(p.paid.keys).union(p.owed.keys)
        let net = people.map { ($0, (p.paid[$0] ?? 0) - (p.owed[$0] ?? 0)) }.sorted { less($0.0, $1.0) }
        var cap: [String: Int] = [:]
        for (u, v) in net where v > 0 { cap[u] = v }
        var out: [(from: String, to: String, minor: Int)] = []
        for (d, v) in net where v < 0 {
            let split = allocateWeighted(-v, cap.filter { $0.value > 0 }.map { ($0.key, $0.value) }, seed: "\(seed):\(d)")
            for (c, m) in split where m != 0 {
                out.append((d, c, m))
                cap[c, default: 0] -= m
            }
        }
        return out
    }

    /// The server's nudge() refuses a reminder unless someone is down more than
    /// 0,50 € (supabase/migrations/20260924010000_leaving_and_nudges.sql) — a
    /// product rule about pestering people over pennies, not a rounding
    /// tolerance. Kept here so the app only offers what the server will send.
    static let nudgeMinimum = 50

    struct Owe: Hashable { let from, to: String; let minor: Int; let amount: Double }

    /// one currency's balances
    struct CurrencyBook {
        let currency: String
        let netMinor: [String: Int]
        let net: [String: Double]
        let owes: [Owe]
    }

    struct Book {
        let currency: String
        /// minor units, for everyone who appears in any expense or settlement in
        /// the main currency — including people who have left — summing to exactly 0
        let netMinor: [String: Int]
        /// the same, in major units, for display
        let net: [String: Double]
        /// who owes whom, pair by pair, netted within each pair only. Largest first.
        let owes: [Owe]
        /// ids of expenses in another currency: kept in their own book in `books`, never added in here
        let excluded: [String]
        let invalid: Int
        /// one book per currency, the main one first
        var books: [CurrencyBook] = []
        static let empty = Book(currency: "EUR", netMinor: [:], net: [:], owes: [], excluded: [], invalid: 0)
    }

    /// the currency most of a flat's live expenses are in (ties: alphabetical); a flat with
    /// none takes the one most of its payments were recorded in, then the fallback
    static func flatCurrency(_ expenses: [some LedgerExpense], _ settles: [some LedgerSettlement], fallback: String) -> String {
        func most(_ cs: [String]) -> String {
            var n: [String: Int] = [:]
            for c in cs where !c.isEmpty { n[c, default: 0] += 1 }
            var best = "", c = 0
            for (k, v) in n where v > c || (v == c && less(k, best)) { best = k; c = v }
            return best
        }
        let e = most(expenses.filter { $0.deletedAt == nil }.map(\.currency))
        if !e.isEmpty { return e }
        let s = most(settles.compactMap(\.currency))
        return s.isEmpty ? fallback : s
    }

    static func build(_ expenses: [some LedgerExpense], _ settles: [some LedgerSettlement], fallback: String = "EUR") -> Book {
        let currency = flatCurrency(expenses, settles, fallback: fallback)
        var net: [String: [String: Int]] = [currency: [:]]
        var pair: [String: [String: Int]] = [currency: [:]]   // per currency: "lo\0hi" → what lo owes hi
        var excluded: [String] = [], invalid = 0
        func owe(_ c: String, _ debtor: String, _ creditor: String, _ v: Int) {
            guard debtor != creditor, v != 0 else { return }
            let lo = less(debtor, creditor)
            pair[c, default: [:]][lo ? debtor + "\u{0}" + creditor : creditor + "\u{0}" + debtor, default: 0] += lo ? v : -v
        }
        for e in expenses where e.deletedAt == nil {
            let c = e.currency.isEmpty ? currency : e.currency
            guard let p = postings(e, currency: c) else { invalid += 1; continue }
            if c != currency { excluded.append(e.id) }
            for (u, v) in p.paid { net[c, default: [:]][u, default: 0] += v }
            for (u, v) in p.owed { net[c, default: [:]][u, default: 0] -= v }
            for d in debts(p, seed: e.id) { owe(c, d.from, d.to, d.minor) }
        }
        for s in settles {
            let c = (s.currency ?? "").isEmpty ? currency : s.currency!
            guard let a = Money.toMinor(s.amount, c), !s.fromUser.isEmpty, !s.toUser.isEmpty, s.fromUser != s.toUser else { invalid += 1; continue }
            net[c, default: [:]][s.fromUser, default: 0] += a
            net[c, default: [:]][s.toUser, default: 0] -= a
            owe(c, s.fromUser, s.toUser, -a)   // paying someone back reduces what you owe them
        }
        let order = net.keys.sorted { $0 == currency ? true : $1 == currency ? false : less($0, $1) }
        let books: [CurrencyBook] = order.map { c in
            var owes: [Owe] = []
            for (k, v) in pair[c] ?? [:] where v != 0 {
                let p = k.split(separator: "\u{0}", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
                owes.append(Owe(from: v > 0 ? p[0] : p[1], to: v > 0 ? p[1] : p[0], minor: abs(v), amount: Money.toMajor(abs(v), c)))
            }
            owes.sort(by: transferOrder)
            let n = net[c] ?? [:]
            return CurrencyBook(currency: c, netMinor: n, net: n.mapValues { Money.toMajor($0, c) }, owes: owes)
        }
        let main = books[0]
        return Book(currency: currency, netMinor: main.netMinor, net: main.net, owes: main.owes,
                    excluded: excluded, invalid: invalid, books: books)
    }

    // MARK: currencies

    /// "0.09563" → (9563, 5): an exchange rate as an exact decimal
    private static func decimal(_ rate: String) -> (Int128, Int)? {
        let t = rate.trimmingCharacters(in: .whitespaces)
        let parts = t.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), !parts[0].isEmpty, parts.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              parts.count == 1 || !parts[1].isEmpty, let n = Int128(parts.joined()), n > 0 else { return nil }
        return (n, parts.count == 2 ? parts[1].count : 0)
    }
    private static func pow10(_ k: Int) -> Int128 { (0..<k).reduce(Int128(1)) { r, _ in r * 10 } }

    /// Balances in several currencies as one figure in `target`, for showing —
    /// the books stay in the currency the money was spent in. `rates[c]`: how
    /// many `target` units one `c` buys, as a decimal string. Rounded with the
    /// largest-remainder method, so it still sums to exactly zero.
    static func convert(_ books: [CurrencyBook], to target: String, rates: [String: String]) -> (net: [String: Int], missing: [String]) {
        let dt = Money.digits(target)
        var terms: [(net: [String: Int], num: Int128, shift: Int)] = [], missing: [String] = []
        for b in books {
            let r: (Int128, Int)? = b.currency == target ? (1, 0) : rates[b.currency].flatMap(decimal)
            guard let r else { missing.append(b.currency); continue }
            terms.append((b.netMinor, r.0 * pow10(dt), r.1 + Money.digits(b.currency)))
        }
        let F = terms.map(\.shift).max() ?? 0, D = pow10(F)
        var exact: [String: Int128] = [:]
        for t in terms {
            let k = t.num * pow10(F - t.shift)
            for (u, v) in t.net { exact[u, default: 0] += Int128(v) * k }
        }
        func floorDiv(_ a: Int128) -> Int128 { a >= 0 ? a / D : -((-a + D - 1) / D) }
        var rows = exact.map { u, x in let f = floorDiv(x); return (u: u, f: f, rem: x - f * D) }
        var short: Int128 = -rows.reduce(0) { $0 + $1.f }
        rows.sort { $0.rem != $1.rem ? $0.rem > $1.rem : less($0.u, $1.u) }
        var net: [String: Int] = [:]
        for r in rows {
            var v = r.f
            if short > 0 && r.rem > 0 { v += 1; short -= 1 }
            net[r.u] = Int(v)
        }
        return (net, missing.sorted(by: less))
    }

    // MARK: recurring

    /// days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's days_from_civil)
    private static func days(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
    private static func civil(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }
    private static func iso(_ y: Int, _ m: Int, _ d: Int) -> String { String(format: "%04d-%02d-%02d", y, m, d) }
    private static func daysIn(_ y: Int, _ m: Int) -> Int { days(m == 12 ? y + 1 : y, m == 12 ? 1 : m + 1, 1) - days(y, m, 1) }

    /// The date of the `n`th time a recurring expense falls due (0 = the first),
    /// counted from the first date: the 31st lands on the 28th/29th in February
    /// and back on the 31st in March — never skipped, never drifting.
    static func occurrence(_ anchor: String, _ cadence: String, _ n: Int) -> String {
        let p = anchor.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return anchor }
        let (y, m, d) = (p[0], p[1], p[2])
        let step = ["weekly": 7, "biweekly": 14][cadence]
        if let step {
            let (yy, mm, dd) = civil(days(y, m, d) + n * step)
            return iso(yy, mm, dd)
        }
        let months = ["monthly": 1, "quarterly": 3, "yearly": 12][cadence] ?? 1
        let k = (m - 1) + n * months
        let yy = y + Int((Double(k) / 12).rounded(.down)), mm = ((k % 12) + 12) % 12 + 1
        return iso(yy, mm, min(d, daysIn(yy, mm)))
    }

    /// the occurrences from number `fromN` due by `today` (and not after `until`), oldest first
    static func dueOccurrences(_ anchor: String, _ cadence: String, from fromN: Int, today: String, until: String? = nil, limit: Int = 400) -> [(n: Int, date: String)] {
        var out: [(n: Int, date: String)] = []
        var n = fromN
        while out.count < limit {
            let date = occurrence(anchor, cadence, n)
            if date > today || (until.map { date > $0 } ?? false) { break }
            out.append((n, date)); n += 1
        }
        return out
    }

    /// what `uid` and each other person owe each other, in minor units; positive: they owe `uid`
    static func pairwise(_ owes: [Owe], for uid: String) -> [String: Int] {
        var out: [String: Int] = [:]
        for o in owes {
            if o.to == uid { out[o.from, default: 0] += o.minor }
            else if o.from == uid { out[o.to, default: 0] -= o.minor }
        }
        return out
    }

    // MARK: settling up with one person

    /// one place (a group, or your non-group expenses) and what the payer owes the
    /// payee there, in minor units of one currency; negative: the payee owes the payer
    struct SpreadPlace: Hashable { let place: String; let owed: Int }
    /// a payment to record in one place; reverse: from the payee to the payer — an
    /// offset where the payee was the one in debt, so that place ends square too
    struct SpreadPart: Hashable { let place: String; let minor: Int; let reverse: Bool }

    /// One payment to one person, spread over every place the two of you owe each
    /// other in, so that each group's own balances stay right (the same rule as
    /// spread() in ledger.ts):
    /// - paying at least what you owe overall settles every place exactly — each is
    ///   paid what it owes, places where they owe you are offset the other way, and
    ///   anything beyond goes to `fallback` (your non-group expenses with them);
    /// - paying less goes to the places you owe in, the largest debt first, never
    ///   more than a place owes; ties by place id;
    /// - owing nothing overall: all of it goes to `fallback`.
    /// The parts add up to exactly `pay` (forward minus reverse), largest first.
    static func spread(_ pay: Int, _ places: [SpreadPlace], fallback: String) -> [SpreadPart] {
        guard pay > 0 else { return [] }
        var t: [String: Int] = [:]
        for p in places where p.owed != 0 { t[p.place] = 0 }
        let net = places.reduce(0) { $0 + $1.owed }
        if net > 0 && pay >= net {
            for p in places where p.owed != 0 { t[p.place, default: 0] += p.owed }
            if pay > net { t[fallback, default: 0] += pay - net }
        } else {
            var left = pay
            let owing = places.filter { $0.owed > 0 }.sorted { $0.owed != $1.owed ? $0.owed > $1.owed : less($0.place, $1.place) }
            for p in owing where left > 0 {
                let v = min(left, p.owed)
                t[p.place, default: 0] += v
                left -= v
            }
            if left > 0 { t[fallback, default: 0] += left }
        }
        return t.filter { $0.value != 0 }
            .sorted { abs($0.value) != abs($1.value) ? abs($0.value) > abs($1.value) : less($0.key, $1.key) }
            .map { SpreadPart(place: $0.key, minor: abs($0.value), reverse: $0.value < 0) }
    }

    // MARK: settle up

    struct Transfer: Hashable { let from, to: String; let minor: Int; let amount: Double }

    /// the exact solver's size limit: 2^12 subsets, well under a millisecond
    static let exactLimit = 12

    /// The fewest payments that bring every balance to exactly zero.
    ///
    /// NP-hard in general, and the old greedy made more payments than necessary
    /// in about 30% of flats while the app promised "the fewest". Up to
    /// `exactLimit` people with money outstanding this is exact: cutting the
    /// balances into the most groups that each sum to zero needs (people −
    /// groups) payments, the minimum, and a dynamic programme over subsets finds
    /// that cut. Beyond the limit, the greedy (never more than people − 1).
    ///
    /// Every tie breaks by id, so the plan is a pure function of the balances.
    /// The old version sorted a Dictionary, whose order Swift randomises per
    /// launch — the same flat could say "pay Cara" on one launch and "pay Dev"
    /// on the next.
    static func plan(_ net: [String: Int], _ cur: String?) -> [Transfer] {
        let entries = net.filter { !$0.key.isEmpty && $0.value != 0 }.map { ($0.key, $0.value) }.sorted { less($0.0, $1.0) }
        let groups = entries.count <= exactLimit ? zeroSumGroups(entries.map(\.1)) : [Array(entries.indices)]
        var out: [Transfer] = []
        for g in groups {
            for t in greedy(g.map { entries[$0] }) {
                out.append(Transfer(from: t.from, to: t.to, minor: t.minor, amount: Money.toMajor(t.minor, cur)))
            }
        }
        return out.sorted(by: transferOrder)
    }

    /// indices of `vals` partitioned into the most subsets that each sum to zero
    static func zeroSumGroups(_ vals: [Int]) -> [[Int]] {
        let n = vals.count
        guard n > 0 else { return [] }
        let full = (1 << n) - 1
        var sums = [Int](repeating: 0, count: full + 1)
        for m in 1...full { let low = m & -m; sums[m] = sums[m ^ low] + vals[low.trailingZeroBitCount] }
        var best = [Int](repeating: 0, count: full + 1), pick = [Int](repeating: 0, count: full + 1)
        for m in 1...full {
            let low = m & -m
            var b = best[m ^ low], p = 0   // the lowest person in no zero-sum group
            var sub = m
            while sub > 0 {
                if sub & low != 0 && sums[sub] == 0 && 1 + best[m ^ sub] > b { b = 1 + best[m ^ sub]; p = sub }
                sub = (sub - 1) & m
            }
            best[m] = b; pick[m] = p
        }
        var groups: [[Int]] = [], rest: [Int] = [], m = full
        while m > 0 {
            let low = m & -m, p = pick[m]
            if p != 0 { groups.append((0..<n).filter { p >> $0 & 1 == 1 }); m ^= p }
            else { rest.append(low.trailingZeroBitCount); m ^= low }
        }
        if !rest.isEmpty { groups.append(rest) }   // unreachable when the balances sum to zero
        return groups
    }

    /// largest debtor pays largest creditor, ties by id; within a zero-sum group of k people, exactly k − 1 payments
    private static func greedy(_ entries: [(String, Int)]) -> [(from: String, to: String, minor: Int)] {
        let order: ((String, Int), (String, Int)) -> Bool = { $0.1 != $1.1 ? $0.1 > $1.1 : less($0.0, $1.0) }
        var debt = entries.filter { $0.1 < 0 }.map { ($0.0, -$0.1) }.sorted(by: order)
        var cred = entries.filter { $0.1 > 0 }.sorted(by: order)
        var out: [(from: String, to: String, minor: Int)] = []
        var i = 0, j = 0
        while i < debt.count && j < cred.count {
            let pay = min(debt[i].1, cred[j].1)
            out.append((debt[i].0, cred[j].0, pay))
            debt[i].1 -= pay; cred[j].1 -= pay
            if debt[i].1 == 0 { i += 1 }
            if cred[j].1 == 0 { j += 1 }
        }
        return out
    }

    private static func transferOrder<T: Transferish>(_ a: T, _ b: T) -> Bool {
        if a.minor != b.minor { return a.minor > b.minor }
        if a.from != b.from { return less(a.from, b.from) }
        return less(a.to, b.to)
    }
}

protocol Transferish { var from: String { get }; var to: String { get }; var minor: Int { get } }
extension Ledger.Owe: Transferish {}
extension Ledger.Transfer: Transferish {}
