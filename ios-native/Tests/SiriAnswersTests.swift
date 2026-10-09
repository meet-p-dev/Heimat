import Foundation

/// Holds SiriAnswers.swift to tests/siri-vectors.json: what Siri says about balances,
/// chores and bills. Money as the app writes it in German ("12,30 €"); days as given.
@main
struct SiriAnswersTests {
    static func money(_ minor: Int, _ cur: String) -> String {
        let s = String(format: "%d,%02d", minor / 100, minor % 100)
        return cur == "EUR" ? "\(s) €" : "\(s) \(cur)"
    }

    static func main() throws {
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
        var fails = 0, n = 0
        func check(_ name: String, _ got: String, _ want: String) {
            n += 1
            if got != want { fails += 1; print("✗ \(name)\n   got  \(got)\n   want \(want)") }
        }
        for case let c as [String: Any] in v["balance"] as! [Any] {
            let lines = (c["lines"] as! [[Any]]).map {
                SiriAnswers.Line(place: $0[0] as! String, placeName: $0[1] as! String, person: $0[2] as! String,
                                 personName: $0[3] as! String, currency: $0[4] as! String, minor: $0[5] as! Int)
            }
            check(c["name"] as! String, SiriAnswers.balance(lines, person: c["person"] as? String, personName: c["personName"] as? String, money: money), c["want"] as! String)
        }
        for case let c as [String: Any] in v["turn"] as! [Any] {
            let turns = (c["turns"] as! [[Any]]).map {
                SiriAnswers.Turn(chore: $0[0] as! String, choreName: $0[1] as! String, n: $0[2] as! Int, assignee: $0[3] as? String,
                                 assigneeName: $0[4] as? String, state: $0[5] as! String, startsOn: $0[6] as! String, endsOn: $0[7] as! String)
            }
            check(c["name"] as! String, SiriAnswers.turn(turns, chore: c["chore"] as? String, me: c["me"] as? String, today: c["today"] as! String, day: { $0 }), c["want"] as! String)
        }
        for case let c as [String: Any] in v["bills"] as! [Any] {
            let bills = (c["bills"] as! [[Any]]).map {
                SiriAnswers.BillDue(name: $0[0] as! String, minor: $0[1] as? Int, currency: $0[2] as! String, dueOn: $0[3] as! String, state: $0[4] as! String)
            }
            check(c["name"] as! String, SiriAnswers.bills(bills, money: money, day: { $0 }), c["want"] as! String)
        }
        print(fails == 0 ? "✔ Swift Siri answers: \(n) checks, 0 failed" : "Swift Siri answers: \(fails) of \(n) failed")
        if fails > 0 { exit(1) }
    }
}
