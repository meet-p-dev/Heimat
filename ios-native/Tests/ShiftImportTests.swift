import Foundation

/// Holds ShiftImport.swift to tests/shift-import-vectors.json (the web importer's answers).
@main
struct ShiftImportTests {
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let have = (v["have"] as! [[String: Any]]).map {
            ShiftImport.Have(id: $0["id"] as? String, date: $0["date"] as! String, employer: $0["employer"] as? String ?? "",
                             start: $0["start"] as? String ?? "", end: $0["end"] as? String ?? "", hours: ($0["hours"] as? NSNumber)?.doubleValue)
        }
        var fails = 0, n = 0
        for case let c as [String: Any] in v["cases"] as! [Any] {
            n += 1
            let name = c["name"] as! String, want = c["want"] as! [String: Any]
            let got = ShiftImport.run(c["text"] as! String, have: have)
            let ws = (want["shifts"] as! [[String: Any]]).map {
                ShiftImport.Row(id: $0["id"] as? String, date: $0["date"] as! String, employer: $0["employer"] as! String,
                                start: $0["start"] as! String, end: $0["end"] as! String, breakMin: ($0["breakMin"] as! NSNumber).intValue,
                                paidBreak: $0["paidBreak"] as! Bool, wage: ($0["wage"] as! NSNumber).doubleValue, hours: ($0["hours"] as? NSNumber)?.doubleValue, pay: ($0["pay"] as? NSNumber)?.doubleValue)
            }
            if got.shifts != ws || got.skipped != want["skipped"] as! Int || got.bad != want["bad"] as! Int {
                fails += 1
                print("✗ \(name): got \(got.shifts.count) skipped \(got.skipped) bad \(got.bad)\n  \(got.shifts)\n  want \(ws)")
            }
        }
        print(fails == 0 ? "✔ Swift shift import: \(n) checks, 0 failed" : "Swift shift import: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
