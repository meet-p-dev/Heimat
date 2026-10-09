import Foundation

/// Holds Receipt.swift to tests/receipt-vectors.json: receipts as the text
/// recognition hands them over, line by line, and what an expense should get.
@main
struct ReceiptTests {
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        let now = f.date(from: v["now"] as! String)!
        var fails = 0, n = 0
        func check<T: Equatable>(_ name: String, _ what: String, _ got: T, _ want: T) {
            n += 1
            if got != want { fails += 1; print("✗ \(name) — \(what): got \(got), want \(want)") }
        }
        for case let c as [String: Any] in v["cases"] as! [Any] {
            let name = c["name"] as! String
            let r = Receipt.read(c["rows"] as! [String], now: now)
            let w = c["want"] as! [String: Any]
            check(name, "store", r.store, w["store"] as? String)
            check(name, "date", r.date, w["date"] as? String)
            check(name, "total", r.total, w["total"] as? Int)
            check(name, "totalSure", r.totalSure, w["totalSure"] as! Bool)
            check(name, "category", r.category, w["category"] as? String)
            let items = (w["items"] as! [[Any]]).map { Receipt.Item(name: $0[0] as! String, minor: $0[1] as! Int) }
            check(name, "items", r.items, items)
            check(name, "discount", r.discount, w["discount"] as! Int)
            check(name, "itemsMatch", r.itemsMatch, w["itemsMatch"] as! Bool)
        }
        for case let pair as [Any] in v["amounts"] as! [Any] {
            let text = pair[0] as! String
            check("amounts", text, Receipt.amounts(text).map(\.minor), pair[1] as! [Int])
        }
        print(fails == 0 ? "✔ Swift receipts: \(n) checks, 0 failed" : "Swift receipts: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
