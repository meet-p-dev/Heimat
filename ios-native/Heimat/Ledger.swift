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
}

protocol LedgerSettlement {
    var fromUser: String { get }
    var toUser: String { get }
    var amount: Double { get }
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

    /// Split `total` minor units between `people` so the parts add up to
    /// exactly `total` (largest remainder; with equal weights the tiebreak
    /// decides). Everyone gets the floor; each leftover cent goes to the next
    /// person by fnv1a(seed + ":" + person). Seeded by the expense id, the odd
    /// cent rotates between people from one expense to the next, yet the same
    /// expense always splits the same way on every device. Duplicates count
    /// once; a negative total (a refund) splits with the sign flipped.
    static func allocate(_ total: Int, _ people: [String], seed: String) -> [String: Int] {
        var seen = Set<String>(), who: [String] = []
        for p in people where !p.isEmpty && seen.insert(p).inserted { who.append(p) }
        guard !who.isEmpty else { return [:] }
        let a = abs(total), base = a / who.count
        var extra = a - base * who.count
        let order = who.map { ($0, fnv1a(seed + ":" + $0)) }.sorted { $0.1 != $1.1 ? $0.1 < $1.1 : less($0.0, $1.0) }
        var out: [String: Int] = [:]
        for (u, _) in order {
            let v = base + (extra > 0 ? 1 : 0)
            if extra > 0 { extra -= 1 }
            out[u] = total < 0 ? -v : v
        }
        return out
    }

    /// everyone the bill is split between; an empty split means the payer alone
    static func participants(_ e: some LedgerExpense) -> [String] {
        guard !e.splitAmong.isEmpty else { return [e.paidBy] }
        var seen = Set<String>()
        return e.splitAmong.filter { seen.insert($0).inserted }
    }

    /// each participant's share of one expense, in minor units, in the order the expense lists them
    static func shares(_ e: some LedgerExpense) -> [(uid: String, minor: Int)] {
        let parts = participants(e)
        let m = allocate(Money.toMinor(e.amount, e.currency) ?? 0, parts, seed: e.id)
        return parts.map { ($0, m[$0] ?? 0) }
    }

    /// one person's share of one expense, in major units; 0 if they are not in it
    static func share(_ e: some LedgerExpense, of uid: String?) -> Double {
        guard let uid, let s = shares(e).first(where: { $0.uid == uid }) else { return 0 }
        return Money.toMajor(s.minor, e.currency)
    }

    /// a person's total share across expenses — their spending — summed in minor units
    static func myShareMinor(_ expenses: [some LedgerExpense], uid: String?) -> Int {
        guard let uid else { return 0 }
        return expenses.reduce(0) { t, e in t + (shares(e).first { $0.uid == uid }?.minor ?? 0) }
    }

    /// The server's nudge() refuses a reminder unless someone is down more than
    /// 0,50 € (supabase/migrations/20260924010000_leaving_and_nudges.sql) — a
    /// product rule about pestering people over pennies, not a rounding
    /// tolerance. Kept here so the app only offers what the server will send.
    static let nudgeMinimum = 50

    struct Owe: Hashable { let from, to: String; let minor: Int; let amount: Double }

    struct Book {
        let currency: String
        /// minor units, for everyone who appears in any expense or settlement —
        /// including people who have left — so it always sums to exactly 0
        let netMinor: [String: Int]
        /// the same, in major units, for display
        let net: [String: Double]
        /// who owes whom, pair by pair, netted within each pair only. Largest first.
        let owes: [Owe]
        /// ids of expenses in another currency, which are never added in
        let excluded: [String]
        let invalid: Int
        static let empty = Book(currency: "EUR", netMinor: [:], net: [:], owes: [], excluded: [], invalid: 0)
    }

    /// the currency most of a flat's expenses are in (ties: alphabetical); settlements carry none and follow it
    static func flatCurrency(_ expenses: [some LedgerExpense], fallback: String) -> String {
        var n: [String: Int] = [:]
        for e in expenses where !e.currency.isEmpty { n[e.currency, default: 0] += 1 }
        var best = "", c = 0
        for (k, v) in n where v > c || (v == c && less(k, best)) { best = k; c = v }
        return best.isEmpty ? fallback : best
    }

    static func build(_ expenses: [some LedgerExpense], _ settles: [some LedgerSettlement], fallback: String = "EUR") -> Book {
        let currency = flatCurrency(expenses, fallback: fallback)
        var net: [String: Int] = [:]
        var pair: [String: Int] = [:]   // "lo\0hi" → what lo owes hi (negative: hi owes lo)
        var excluded: [String] = [], invalid = 0
        func owe(_ debtor: String, _ creditor: String, _ v: Int) {
            guard debtor != creditor, v != 0 else { return }
            let lo = less(debtor, creditor)
            pair[lo ? debtor + "\u{0}" + creditor : creditor + "\u{0}" + debtor, default: 0] += lo ? v : -v
        }
        for e in expenses {
            if !e.currency.isEmpty && e.currency != currency { excluded.append(e.id); continue }
            guard let total = Money.toMinor(e.amount, currency), !e.paidBy.isEmpty else { invalid += 1; continue }
            net[e.paidBy, default: 0] += total
            for (u, s) in allocate(total, participants(e), seed: e.id) {
                net[u, default: 0] -= s
                owe(u, e.paidBy, s)
            }
        }
        for s in settles {
            guard let a = Money.toMinor(s.amount, currency), !s.fromUser.isEmpty, !s.toUser.isEmpty, s.fromUser != s.toUser else { invalid += 1; continue }
            net[s.fromUser, default: 0] += a
            net[s.toUser, default: 0] -= a
            owe(s.fromUser, s.toUser, -a)   // paying someone back reduces what you owe them
        }
        var owes: [Owe] = []
        for (k, v) in pair where v != 0 {
            let p = k.split(separator: "\u{0}", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            owes.append(Owe(from: v > 0 ? p[0] : p[1], to: v > 0 ? p[1] : p[0], minor: abs(v), amount: Money.toMajor(abs(v), currency)))
        }
        owes.sort(by: transferOrder)
        return Book(currency: currency, netMinor: net, net: net.mapValues { Money.toMajor($0, currency) },
                    owes: owes, excluded: excluded, invalid: invalid)
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
