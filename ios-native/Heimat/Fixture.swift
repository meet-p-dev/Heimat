#if DEBUG
import Foundation

/// Made-up groups, friends and expenses for looking at the screens without the
/// network. Launch with `-HeimatFixture` (debug builds only): the app then never
/// signs in or talks to Supabase — opening the real app root would create an
/// anonymous account in production. Saving from this mode is not supported.
extension AppModel {
    static var fixtureMode: Bool { ProcessInfo.processInfo.arguments.contains("-HeimatFixture") }

    func loadFixture() {
        let me = "00000000-0000-4000-a000-000000000001"
        let nina = "00000000-0000-4000-a000-000000000002", tom = "00000000-0000-4000-a000-000000000003"
        let sara = "00000000-0000-4000-a000-000000000004", alex = "00000000-0000-4000-a000-000000000005"
        let ben = "00000000-0000-4000-a000-000000000006", dana = "00000000-0000-4000-a000-000000000007"
        let kim = "00000000-0000-4000-a000-000000000008", vi = "00000000-0000-4000-a000-000000000009"
        let flat = "10000000-0000-4000-a000-000000000001", meevi = "10000000-0000-4000-a000-000000000002"
        let cNina = "20000000-0000-4000-a000-000000000001", cTrio = "20000000-0000-4000-a000-000000000002"
        let cSara = "20000000-0000-4000-a000-000000000003", cTom = "20000000-0000-4000-a000-000000000004"
        let now = "2026-09-01T10:00:00Z"

        profile.onboarded = true
        if profile.name.isEmpty { profile.name = "Meet Patel" }
        uid = me
        isAnon = false
        flats = [Flat(id: flat, name: "Münchener Straße 67", joinCode: "DD325F", kind: "flat"),
                 Flat(id: meevi, name: "Meevi flat", joinCode: "7KQ2PA", kind: "group")]
        circles = [cNina, cTrio, cSara, cTom].map { Flat(id: $0, name: "", joinCode: "", kind: "direct") }
        var n = 0
        func mem(_ f: String, _ u: String, _ name: String, pending: String? = nil) -> Member {
            n += 1
            return Member(id: "m\(n)", flatId: f, userId: u, displayName: name, inviteEmail: pending,
                          claimedAt: pending == nil ? now : nil, inviteToken: pending == nil ? nil : "tok\(n)")
        }
        allMembers = [
            mem(flat, me, "Meet Patel"), mem(flat, alex, "Alex"), mem(flat, ben, "Ben"), mem(flat, dana, "Dana Schulz"),
            mem(flat, kim, "Kai"), mem(flat, nina, "Nina"),
            mem(meevi, me, "Meet Patel"), mem(meevi, vi, "Vi"),
            mem(cNina, me, "Meet Patel"), mem(cNina, nina, "Nina"),
            mem(cTrio, me, "Meet Patel"), mem(cTrio, nina, "Nina"), mem(cTrio, tom, "Tom"),
            mem(cSara, me, "Meet Patel"), mem(cSara, sara, "Sara", pending: "sara@example.com"),
            mem(cTom, me, "Meet Patel"), mem(cTom, tom, "Tom"),
        ]
        func ex(_ id: String, _ f: String, _ d: String, _ amt: Double, _ by: String, _ among: [String], _ day: String, cat: String = "food", cur: String = "EUR") -> Expense {
            Expense(id: "30000000-0000-4000-a000-0000000000" + id, flatId: f, description: d, amount: amt, currency: cur, paidBy: by,
                    splitAmong: among, category: cat, spentOn: day, createdBy: by)
        }
        allExpenses = [
            ex("01", cNina, "Dinner at Thai Park", 30, me, [me, nina], "2026-09-28"),
            ex("02", cNina, "Cinema", 18, nina, [me, nina], "2026-09-20", cat: "fun"),
            ex("03", cTrio, "Taxi to the airport", 42, me, [me, nina, tom], "2026-09-25", cat: "transport"),
            ex("04", cSara, "Concert tickets", 10.8, me, [me, sara], "2026-09-22", cat: "fun"),
            ex("05", cTom, "Lunch", 8.4, tom, [me, tom], "2026-09-26"),
            ex("06", flat, "Rewe groceries", 64.2, alex, [me, alex, ben, dana, kim, nina], "2026-09-27", cat: "groceries"),
            ex("07", flat, "Internet", 39.99, me, [me, alex, ben, dana, kim, nina], "2026-09-01", cat: "utilities"),
            ex("08", meevi, "Ikea", 80, vi, [me, vi], "2026-08-30", cat: "home"),
            ex("09", meevi, "Pizza", 22, me, [me, vi], "2026-08-30"),
        ]
        allSettles = [Settlement(id: "s1", flatId: meevi, fromUser: me, toUser: vi, amount: 29, settledOn: "2026-09-02", currency: "EUR")]
        flatId = flat
        members = allMembers.filter { $0.flatId == flat }
        expenses = allExpenses.filter { $0.flatId == flat }
        settles = allSettles.filter { $0.flatId == flat }
        tab = .flat
    }

    /// a circle made on the phone for the people picked, as the server would
    func fixtureCircle(_ picks: [PersonPick]) -> String? {
        guard let uid else { return nil }
        let id = "2f000000-0000-4000-a000-" + String(format: "%012d", circles.count + 1)
        circles.append(Flat(id: id, name: "", joinCode: "", kind: "direct"))
        var rows = [Member(id: id + "me", flatId: id, userId: uid, displayName: personName(uid), claimedAt: "2026-10-01T00:00:00Z")]
        for (i, p) in picks.enumerated() {
            let u = p.userId ?? "2e000000-0000-4000-a000-" + String(format: "%012d", allMembers.count + i)
            rows.append(Member(id: id + "\(i)", flatId: id, userId: u, displayName: p.userId.map(personName) ?? p.name,
                               inviteEmail: p.userId == nil ? p.email : nil,
                               claimedAt: p.userId == nil ? nil : "2026-10-01T00:00:00Z", inviteToken: p.userId == nil ? "tok" : nil))
        }
        allMembers += rows
        return id
    }
}
#endif
