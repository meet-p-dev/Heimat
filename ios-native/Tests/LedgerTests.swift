import Foundation

// Holds ios-native/Heimat/Ledger.swift to the exact answers the web engine
// gives (tests/ledger-vectors.json), then checks the same guarantees as
// tests/ledger.test.ts on random flats. Plain swiftc, no simulator:
//
//   npm run test:swift

struct E: LedgerExpense, Decodable {
    let id: String; let amount: Double; let currency: String; let paidBy: String; let splitAmong: [String]
    enum CodingKeys: String, CodingKey { case id, amount, currency, paidBy = "paid_by", splitAmong = "split_among" }
}
struct S: LedgerSettlement, Decodable {
    let id: String; let amount: Double; let fromUser: String; let toUser: String
    enum CodingKeys: String, CodingKey { case id, amount, fromUser = "from_user", toUser = "to_user" }
}
struct T: Decodable, Equatable { let from: String; let to: String; let minor: Int }
struct Vectors: Decodable {
    struct Fnv: Decodable { let s: String; let h: UInt32 }
    struct Minor: Decodable { let major: Double; let cur: String; let minor: Int }
    struct Parse: Decodable { let s: String; let cur: String; let minor: Int? }
    struct Alloc: Decodable { let total: Int; let people: [String]; let seed: String; let out: [String: Int] }
    struct Book: Decodable {
        let expenses: [E]; let settles: [S]; let currency: String; let excluded: [String]
        let shares: [String: [[Share]]]; let net: [String: Int]; let owes: [T]; let plan: [T]
    }
    enum Share: Decodable {
        case uid(String), minor(Int)
        init(from d: Decoder) throws {
            let c = try d.singleValueContainer()
            if let i = try? c.decode(Int.self) { self = .minor(i) } else { self = .uid(try c.decode(String.self)) }
        }
    }
    struct Plan: Decodable { let net: [[NetEntry]]; let plan: [T] }
    enum NetEntry: Decodable {
        case uid(String), minor(Int)
        init(from d: Decoder) throws {
            let c = try d.singleValueContainer()
            if let i = try? c.decode(Int.self) { self = .minor(i) } else { self = .uid(try c.decode(String.self)) }
        }
    }
    let fnv: [Fnv]; let minor: [Minor]; let parse: [Parse]; let alloc: [Alloc]; let ledgers: [Book]; let plans: [Plan]
}

@main
struct LedgerTests {
    static var failures = 0, checks = 0
    static func expect(_ ok: Bool, _ what: @autoclosure () -> String) {
        checks += 1
        if !ok { failures += 1; if failures <= 25 { print("✖ " + what()) } }
    }

    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "tests/ledger-vectors.json")
        let v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: root))

        for c in v.fnv { expect(Ledger.fnv1a(c.s) == c.h, "fnv1a(\(c.s.debugDescription)) = \(Ledger.fnv1a(c.s)), want \(c.h)") }
        for c in v.minor { expect(Money.toMinor(c.major, c.cur) == c.minor, "toMinor(\(c.major), \(c.cur)) = \(String(describing: Money.toMinor(c.major, c.cur))), want \(c.minor)") }
        for c in v.parse { expect(Money.parse(c.s, c.cur) == c.minor, "parse(\(c.s.debugDescription), \(c.cur)) = \(String(describing: Money.parse(c.s, c.cur))), want \(String(describing: c.minor))") }
        for c in v.alloc { expect(Ledger.allocate(c.total, c.people, seed: c.seed) == c.out, "allocate(\(c.total), seed \(c.seed))") }

        for (i, b) in v.ledgers.enumerated() {
            let book = Ledger.build(b.expenses, b.settles)
            expect(book.currency == b.currency, "ledger \(i): currency \(book.currency) ≠ \(b.currency)")
            expect(book.excluded == b.excluded, "ledger \(i): excluded \(book.excluded) ≠ \(b.excluded)")
            expect(book.netMinor.filter { $0.value != 0 } == b.net.filter { $0.value != 0 }, "ledger \(i): net differs")
            expect(book.owes.map { T(from: $0.from, to: $0.to, minor: $0.minor) } == b.owes, "ledger \(i): owes differ")
            expect(Ledger.plan(book.netMinor, book.currency).map { T(from: $0.from, to: $0.to, minor: $0.minor) } == b.plan, "ledger \(i): plan differs")
            for e in b.expenses {
                let want = (b.shares[e.id] ?? []).compactMap { pair -> (String, Int)? in
                    guard pair.count == 2, case .uid(let u) = pair[0], case .minor(let m) = pair[1] else { return nil }
                    return (u, m)
                }
                let got = Ledger.shares(e)
                expect(got.map(\.uid) == want.map(\.0) && got.map(\.minor) == want.map(\.1), "ledger \(i): shares of \(e.id)")
            }
        }
        for (i, p) in v.plans.enumerated() {
            var net: [String: Int] = [:]
            for pair in p.net { if case .uid(let u) = pair[0], case .minor(let m) = pair[1] { net[u] = m } }
            expect(Ledger.plan(net, "EUR").map { T(from: $0.from, to: $0.to, minor: $0.minor) } == p.plan, "plan \(i) differs")
        }
        let vectorChecks = checks

        // the same guarantees as the TypeScript suite, on random flats
        var rng = SplitMix(seed: 42)
        let people = ["ana", "ben", "cara", "dev", "eli", "fin", "gus", "hal"]
        for f in 0..<2000 {
            let who = Array(people.prefix(2 + Int(rng.next() % 7)))
            var es: [E] = []
            for i in 0..<Int(rng.next() % 40) {
                es.append(E(id: "e\(f)-\(i)", amount: Double(1 + rng.next() % 50000) / 100, currency: "EUR",
                            paidBy: who[Int(rng.next() % UInt64(who.count))], splitAmong: who.filter { _ in rng.next() % 10 < 7 }))
            }
            let book = Ledger.build(es, [S]())
            expect(book.netMinor.values.reduce(0, +) == 0, "flat \(f): balances do not sum to zero")
            for (u, n) in book.netMinor { expect(Ledger.pairwise(book.owes, for: u).values.reduce(0, +) == n, "flat \(f): \(u)'s lines ≠ balance") }
            var after = book.netMinor
            for t in Ledger.plan(book.netMinor, "EUR") { after[t.from, default: 0] += t.minor; after[t.to, default: 0] -= t.minor }
            expect(after.values.allSatisfy { $0 == 0 }, "flat \(f): plan leaves a balance")
            // same data, fresh dictionaries in a different order: same plan (the launch-to-launch bug)
            let shuffled = Dictionary(uniqueKeysWithValues: book.netMinor.shuffled(using: &rng))
            expect(Ledger.plan(shuffled, "EUR") == Ledger.plan(book.netMinor, "EUR"), "flat \(f): plan depends on dictionary order")
        }

        let t0 = Date()
        var big: [String: Int] = [:]
        for k in 0..<Ledger.exactLimit { big["p\(k)"] = (k % 2 == 0 ? -1 : 1) * (1000 + k * 37) }
        big["p0"]! -= big.values.reduce(0, +)
        for _ in 0..<10 { _ = Ledger.plan(big, "EUR") }
        let ms = Date().timeIntervalSince(t0) * 100
        expect(ms < 25, "plan at the exact limit took \(ms) ms")

        print("\(failures == 0 ? "✔" : "✖") Swift ledger: \(vectorChecks) vector checks, \(checks - vectorChecks) property checks, \(failures) failed · plan at n=\(Ledger.exactLimit): \(String(format: "%.2f", ms)) ms")
        exit(failures == 0 ? 0 : 1)
    }
}

struct SplitMix: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
