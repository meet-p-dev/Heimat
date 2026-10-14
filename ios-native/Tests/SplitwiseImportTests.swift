import Foundation

/// Holds SplitwiseImport.swift to tests/splitwise-import-vectors.json (the web importer's answers).
@main
struct SplitwiseImportTests {
    static func ints(_ o: Any?) -> [String: Int] {
        ((o as? [String: Any]) ?? [:]).mapValues { ($0 as! NSNumber).intValue }
    }
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var fails = 0, n = 0
        for case let c as [String: Any] in v["cases"] as! [Any] {
            n += 1
            let name = c["name"] as! String, want = c["want"] as! [String: Any]
            let got = SplitwiseImport.run(c["text"] as! String, fileName: c["file"] as! String)
            if want["ok"] as! Bool {
                let w = want["file"] as! [String: Any]
                let wf = SplitwiseImport.File(
                    name: w["name"] as! String,
                    people: (w["people"] as! [[String: Any]]).map { .init(key: $0["key"] as! String, name: $0["name"] as! String) },
                    expenses: (w["expenses"] as! [[String: Any]]).map {
                        .init(d: $0["d"] as! String, t: $0["t"] as! String, c: $0["c"] as! String, cur: $0["cur"] as! String,
                              total: ($0["total"] as! NSNumber).intValue, paid: ints($0["paid"]), owed: ints($0["owed"]))
                    },
                    payments: (w["payments"] as! [[String: Any]]).map {
                        .init(d: $0["d"] as! String, t: $0["t"] as! String, from: $0["from"] as! String, to: $0["to"] as! String,
                              cur: $0["cur"] as! String, total: ($0["total"] as! NSNumber).intValue)
                    },
                    balances: ints(w["balances"]),
                    totals: SplitwiseImport.Totals(rawValue: w["totals"] as! String)!,
                    skipped: w["skipped"] as! Int,
                    bad: w["bad"] as! [Int],
                    from: w["from"] as? String, to: w["to"] as? String,
                    currencies: w["currencies"] as! [String])
                if case .success(let f) = got, f == wf { continue }
                fails += 1
                print("✗ \(name):\n  got  \(got)\n  want \(wf)")
            } else {
                if case .failure(let e) = got, e.rawValue == want["error"] as! String { continue }
                fails += 1
                print("✗ \(name): got \(got), want \(want["error"]!)")
            }
        }
        let people: [SplitwiseImport.Person] = [.init(key: "0", name: "Alex Kim"), .init(key: "1", name: "Priya Nair"), .init(key: "2", name: "Priya S.")]
        for (input, want) in [("alex kim", "0"), ("Alex", "0"), ("Priya", nil), ("", nil)] as [(String, String?)] {
            n += 1
            if SplitwiseImport.guessMe(people, input) != want { fails += 1; print("✗ guessMe \(input)") }
        }
        print(fails == 0 ? "✔ Swift Splitwise import: \(n) checks, 0 failed" : "Swift Splitwise import: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
