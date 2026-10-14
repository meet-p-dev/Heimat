import Foundation

/// Holds ExpenseImport.swift and Xlsx.swift to tests/expense-import-vectors.json (the web
/// importer's answers).
@main
struct ExpenseImportTests {
    static func ints(_ o: Any?) -> [String: Int] {
        ((o as? [String: Any]) ?? [:]).mapValues { ($0 as! NSNumber).intValue }
    }
    static func file(_ w: [String: Any]) -> ExpenseImport.File {
        ExpenseImport.File(
            name: w["name"] as! String,
            layout: ExpenseImport.Layout(rawValue: w["layout"] as! String)!,
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
            totals: ExpenseImport.Totals(rawValue: w["totals"] as! String)!,
            skipped: w["skipped"] as! Int,
            bad: w["bad"] as! [Int],
            from: w["from"] as? String, to: w["to"] as? String,
            currencies: w["currencies"] as! [String])
    }
    static func result(_ want: [String: Any]) -> ExpenseImport.Result {
        if want["ok"] as! Bool { return .ok(file(want["file"] as! [String: Any])) }
        switch want["error"] as! String {
        case "empty": return .empty
        case "too_large": return .tooLarge
        default: return .notRecognised(header: want["header"] as! [String], sample: want["sample"] as! [[String]])
        }
    }

    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var fails = 0, n = 0
        for case let c as [String: Any] in v["cases"] as! [Any] {
            n += 1
            let name = c["name"] as! String, fileName = c["file"] as! String
            let opts = c["opts"] as? [String: Any] ?? [:]
            let cur = opts["currency"] as? String ?? "EUR"
            var map: ExpenseImport.ColumnMap?
            if let m = opts["map"] as? [String: Int] {
                map = .init(date: m["date"]!, description: m["description"]!, amount: m["amount"]!, payer: m["payer"]!,
                            forWhom: m["forWhom"]!, currency: m["currency"]!, category: m["category"]!)
            }
            let got: ExpenseImport.Result
            if c["kind"] as! String == "xlsx" {
                let sheets = try Xlsx.read(Data(base64Encoded: c["b64"] as! String)!)
                if sheets != c["sheets"] as! [[[String]]] { fails += 1; print("✗ \(name): sheets\n  got  \(sheets)\n  want \(c["sheets"]!)") }
                got = ExpenseImport.sheets(sheets, fileName: fileName, currency: cur)
            } else {
                got = ExpenseImport.csv(c["text"] as! String, fileName: fileName, currency: cur, map: map)
            }
            let want = result(c["want"] as! [String: Any])
            if got != want { fails += 1; print("✗ \(name):\n  got  \(got)\n  want \(want)") }
        }
        let people: [ExpenseImport.Person] = [.init(key: "0", name: "Alex Kim"), .init(key: "1", name: "Priya Nair"), .init(key: "2", name: "Priya S.")]
        for (input, want) in [("alex kim", "0"), ("Alex", "0"), ("Priya", nil), ("", nil)] as [(String, String?)] {
            n += 1
            if ExpenseImport.guessMe(people, input) != want { fails += 1; print("✗ guessMe \(input)") }
        }
        for (input, mf, want) in [("10/13/2025", true, "2025-10-13"), ("13/10/2025", false, "2025-10-13"), ("45748", false, "2025-04-01"),
                                  ("2 Oct 2025", false, "2025-10-02"), ("Oct 2, 2025", false, "2025-10-02"), ("20230722", false, "2023-07-22"),
                                  ("2. März 2025", false, "2025-03-02")] as [(String, Bool, String)] {
            n += 1
            if ExpenseImport.date(input, monthFirst: mf) != want { fails += 1; print("✗ date \(input): \(String(describing: ExpenseImport.date(input, monthFirst: mf)))") }
        }
        for (input, want) in [("33.333333333333336", 3333), ("€ 12,50", 1250), ("", 0)] as [(String, Int)] {
            n += 1
            if ExpenseImport.sheetAmount(input, "EUR") != want { fails += 1; print("✗ sheetAmount \(input)") }
        }
        print(fails == 0 ? "✔ Swift expense import: \(n) checks, 0 failed" : "Swift expense import: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
