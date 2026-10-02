import Foundation

/// Holds Suggest.swift to tests/suggest-vectors.json (the web engine's answers).
@main
struct SuggestTests {
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        var fails = 0, n = 0
        for case let pair as [Any] in v["builtin"] as! [Any] {
            n += 1
            let text = pair[0] as! String, want = pair[1] as? String
            let got = Suggest.builtin(text)
            if got != want { fails += 1; print("✗ builtin \(text): \(got ?? "nil") ≠ \(want ?? "nil")") }
        }
        let l = v["learned"] as! [String: Any]
        let history = (l["history"] as! [[String: String]]).map { (description: $0["description"]!, category: $0["category"]!) }
        let learned = Suggest.learn(history)
        for case let pair as [Any] in l["cases"] as! [Any] {
            n += 1
            let text = pair[0] as! String, want = pair[1] as? String
            let got = Suggest.category(text, learned)
            if got != want { fails += 1; print("✗ learned \(text): \(got ?? "nil") ≠ \(want ?? "nil")") }
        }
        print(fails == 0 ? "✔ Swift suggest: \(n) checks, 0 failed" : "Swift suggest: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
