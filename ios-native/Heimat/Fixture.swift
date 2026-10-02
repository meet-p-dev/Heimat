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
        bills = [
            Bill(id: "b1", flatId: flat, ownerId: nil, name: "Rent", amount: 2_340, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-01", payer: alex),
            Bill(id: "b2", flatId: flat, ownerId: nil, name: "Electricity", amount: nil, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-15", payer: me),
            Bill(id: "b3", flatId: flat, ownerId: nil, name: "Internet", amount: 39.99, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-12",
                 payer: me, contractEndsOn: "2026-12-31", noticeAmount: 1, noticeUnit: "month"),
            Bill(id: "b4", flatId: nil, ownerId: me, name: "Phone", amount: 20, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-03", payer: me),
            Bill(id: "b5", flatId: nil, ownerId: me, name: "Gym", amount: 29.9, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-28", payer: me),
        ]
        billStatus = Dictionary(uniqueKeysWithValues: [
            BillStatus(billId: "b1", dueOn: "2026-10-01", state: "due", paidOn: "2026-09-01", paidBy: alex, cancelBy: nil),
            BillStatus(billId: "b2", dueOn: "2026-09-15", state: "overdue", paidOn: nil, paidBy: nil, cancelBy: nil),
            BillStatus(billId: "b3", dueOn: "2026-10-12", state: "upcoming", paidOn: "2026-09-12", paidBy: me, cancelBy: "2026-11-30"),
            BillStatus(billId: "b4", dueOn: "2026-10-03", state: "upcoming", paidOn: nil, paidBy: nil, cancelBy: nil),
            BillStatus(billId: "b5", dueOn: "2026-10-28", state: "paid", paidOn: "2026-09-28", paidBy: me, cancelBy: nil),
        ].map { ($0.billId, $0) })
        let rota = [me, alex, ben, dana, kim, nina]
        chores = [
            Chore(id: "c1", flatId: flat, name: "Bathroom", cadence: "weekly", anchorOn: "2026-09-07", points: 3, rota: rota),
            Chore(id: "c2", flatId: flat, name: "Kitchen", cadence: "weekly", anchorOn: "2026-09-07", points: 2, rota: rota),
            Chore(id: "c3", flatId: flat, name: "Trash", cadence: "weekly", anchorOn: "2026-09-07", points: 1, rota: rota),
            Chore(id: "c4", flatId: flat, name: "Vacuuming", cadence: "biweekly", anchorOn: "2026-09-21", points: 2, rota: rota),
        ]
        func turn(_ c: String, _ n: Int, _ s: String, _ e: String, _ who: String, _ state: String = "open", by: String? = nil, pts: Int? = nil) -> ChoreTurn {
            ChoreTurn(choreId: c, n: n, flatId: flat, startsOn: s, endsOn: e, assignee: who, state: state, doneBy: by, doneAt: by == nil ? nil : "2026-09-30T18:00:00Z", points: pts)
        }
        choreTurns = [
            turn("c1", 3, "2026-09-28", "2026-10-04", me), turn("c1", 4, "2026-10-05", "2026-10-11", alex),
            turn("c2", 3, "2026-09-28", "2026-10-04", nina, "done", by: nina, pts: 2), turn("c2", 4, "2026-10-05", "2026-10-11", me),
            turn("c3", 3, "2026-09-28", "2026-10-04", ben), turn("c3", 4, "2026-10-05", "2026-10-11", dana),
            turn("c4", 0, "2026-09-21", "2026-10-04", dana), turn("c4", 1, "2026-10-05", "2026-10-18", kim),
        ]
        choreSwaps = [ChoreSwap(id: "w1", choreId: "c4", n: 0, flatId: flat, fromUser: dana, toUser: me)]
        choresDone = [turn("c2", 3, "2026-09-28", "2026-10-04", nina, "done", by: nina, pts: 2)]
        // a working student with two jobs this month (the tax estimate on the Work tab)
        profile.tax = TaxDetails()
        profile.jobs = ["Uni lab": JobSetting(kind: "werkstudent", main: true), "Café Mondo": JobSetting(kind: "minijob", main: false)]
        let month = String(Fmt.today().prefix(7))
        shifts = [("01", "Uni lab", 8), ("02", "Uni lab", 8), ("05", "Uni lab", 6), ("06", "Café Mondo", 5), ("08", "Uni lab", 8), ("09", "Café Mondo", 6)].map { d, emp, h in
            var s = Shift(); s.date = "\(month)-\(d)"; s.employer = emp; s.start = "09:00"; s.end = String(format: "%02d:00", 9 + h); s.wage = emp == "Uni lab" ? 15.5 : 13.9
            return s
        }
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
