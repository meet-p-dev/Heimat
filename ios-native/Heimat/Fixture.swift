#if DEBUG
import Foundation

/// Made-up groups, friends and expenses for looking at the screens without the
/// network. Launch with `-HeimatFixture` (debug builds only): the app then never
/// signs in or talks to Supabase — opening the real app root would create an
/// anonymous account in production. Saving from this mode is not supported.
extension AppModel {
    static var fixtureMode: Bool { ProcessInfo.processInfo.arguments.contains("-HeimatFixture") }

    func loadFixture() {
        // Everyone here is made up — Priya, an Indian student in Germany, her WG, a trip, her
        // brother and friends — with two months of life, dated back from today so the
        // screenshots always look current. No real names, places or addresses.
        let me = "00000000-0000-4000-a000-000000000001"
        let sofia = "00000000-0000-4000-a000-000000000002", omar = "00000000-0000-4000-a000-000000000003"
        let rahul = "00000000-0000-4000-a000-000000000004", jonas = "00000000-0000-4000-a000-000000000005"
        let mateo = "00000000-0000-4000-a000-000000000006", lea = "00000000-0000-4000-a000-000000000007"
        let aiko = "00000000-0000-4000-a000-000000000008", arjun = "00000000-0000-4000-a000-000000000009"
        let flat = "10000000-0000-4000-a000-000000000001", family = "10000000-0000-4000-a000-000000000002"
        let trip = "10000000-0000-4000-a000-000000000003"
        let cSofia = "20000000-0000-4000-a000-000000000001", cTrio = "20000000-0000-4000-a000-000000000002"
        let cRahul = "20000000-0000-4000-a000-000000000003", cOmar = "20000000-0000-4000-a000-000000000004"
        let cal = Calendar(identifier: .gregorian)
        let today = Fmt.date(Fmt.today()) ?? Date()
        /// the day n days ago, yyyy-MM-dd
        func ago(_ n: Int) -> String { Fmt.ymd(cal.date(byAdding: .day, value: -n, to: today) ?? today) }
        func at(_ n: Int, _ hm: String) -> String { "\(ago(n))T\(hm):00.000000+00:00" }
        let now = "\(ago(70))T10:00:00Z"

        // -HeimatNew: a brand-new person (setup not done, nothing yet) for looking at setup and
        // Get started; add -HeimatInvited to arrive from a group's invite link
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-HeimatNew") {
            profile = Profile()
            uid = me
            isAnon = true
            flats = []; circles = []; allExpenses = []; shifts = []
            UserDefaults.standard.set(false, forKey: Push.askedKey)
            if args.contains("-HeimatInvited") { pendingLink = .join("SUN4WG") }
            // -HeimatSetUp: setup just finished (a student with a job in a WG), nothing added yet
            if args.contains("-HeimatSetUp") {
                profile.name = "Ana"; profile.share = ["flatmates", "friends"]; profile.doing = ["study", "shifts"]
                profile.rate = 106.61; profile.onboarded = true
                UserDefaults.standard.set(false, forKey: "mt-h-start-hidden")
            }
            return
        }

        profile.onboarded = true
        profile.name = "Priya Nair"
        // a real-looking rupee rate, so amounts show in both currencies the way they do for testers
        if profile.rate == 1 { profile.rate = 108.35 }
        // screenshots: the notifications card is already answered
        UserDefaults.standard.set(true, forKey: Push.askedKey)
        uid = me
        isAnon = false
        email = "priya@example.com"
        flats = [Flat(id: flat, name: "Sunny WG", joinCode: "SUN4WG", kind: "flat"),
                 Flat(id: trip, name: "Lisbon trip", joinCode: "LIS8ON", kind: "group"),
                 Flat(id: family, name: "Family", joinCode: "FAM1LY", kind: "group")]
        circles = [cSofia, cTrio, cRahul, cOmar].map { Flat(id: $0, name: "", joinCode: "", kind: "direct") }
        var n = 0
        func mem(_ f: String, _ u: String, _ name: String, pending: String? = nil) -> Member {
            n += 1
            return Member(id: "m\(n)", flatId: f, userId: u, displayName: name, inviteEmail: pending,
                          claimedAt: pending == nil ? now : nil, inviteToken: pending == nil ? nil : "tok\(n)")
        }
        allMembers = [
            mem(flat, me, "Priya Nair"), mem(flat, jonas, "Jonas"), mem(flat, mateo, "Mateo"), mem(flat, lea, "Lea Schmidt"),
            mem(flat, aiko, "Aiko"), mem(flat, sofia, "Sofia"),
            mem(trip, me, "Priya Nair"), mem(trip, lea, "Lea Schmidt"), mem(trip, sofia, "Sofia"),
            mem(family, me, "Priya Nair"), mem(family, arjun, "Arjun"),
            mem(cSofia, me, "Priya Nair"), mem(cSofia, sofia, "Sofia"),
            mem(cTrio, me, "Priya Nair"), mem(cTrio, sofia, "Sofia"), mem(cTrio, omar, "Omar"),
            mem(cRahul, me, "Priya Nair"), mem(cRahul, rahul, "Rahul", pending: "rahul@example.com"),
            mem(cOmar, me, "Priya Nair"), mem(cOmar, omar, "Omar"),
        ]
        var k = 0
        func ex(_ f: String, _ d: String, _ amt: Double, _ by: String, _ among: [String], _ daysAgo: Int, cat: String = "food") -> Expense {
            k += 1
            return Expense(id: "30000000-0000-4000-a000-" + String(format: "%012d", k), flatId: f, description: d, amount: amt, currency: "EUR", paidBy: by,
                           splitAmong: among, category: cat, spentOn: ago(daysAgo), createdBy: by)
        }
        let wg = [me, jonas, mateo, lea, aiko, sofia]
        allExpenses = [
            // the WG, week by week
            ex(flat, "Rewe groceries", 64.20, jonas, wg, 2, cat: "groceries"),
            ex(flat, "Toilet paper & dish soap", 14.85, me, wg, 4, cat: "household"),
            ex(flat, "Lidl groceries", 48.60, me, wg, 9, cat: "groceries"),
            ex(flat, "WG dinner", 38.40, lea, wg, 12),
            ex(flat, "Rewe groceries", 71.15, aiko, wg, 16, cat: "groceries"),
            ex(flat, "Internet", 39.99, me, wg, 30, cat: "utilities"),
            ex(flat, "Plants for the balcony", 26.00, sofia, wg, 33, cat: "home"),
            ex(flat, "Lidl groceries", 52.30, mateo, wg, 37, cat: "groceries"),
            ex(flat, "Dishwasher tabs", 9.95, me, wg, 44, cat: "household"),
            ex(flat, "Internet", 39.99, me, wg, 60, cat: "utilities"),
            ex(flat, "Welcome dinner", 54.00, me, wg, 62),
            // the trip
            ex(trip, "Flights to Lisbon", 267.00, me, [me, lea, sofia], 26, cat: "transport"),
            ex(trip, "Apartment, 3 nights", 312.00, lea, [me, lea, sofia], 24, cat: "home"),
            ex(trip, "Tram passes", 19.20, sofia, [me, lea, sofia], 22, cat: "transport"),
            ex(trip, "Seafood dinner", 84.60, me, [me, lea, sofia], 21),
            // family
            ex(family, "Mum’s birthday gift", 60.00, me, [me, arjun], 18, cat: "fun"),
            ex(family, "Flowers for Nani", 25.00, arjun, [me, arjun], 40, cat: "fun"),
            // friends, no group
            ex(cSofia, "Sushi night", 46.00, me, [me, sofia], 5),
            ex(cSofia, "Cinema", 22.00, sofia, [me, sofia], 19, cat: "fun"),
            ex(cTrio, "Taxi from the airport", 42.00, me, [me, sofia, omar], 20, cat: "transport"),
            ex(cRahul, "Concert tickets", 79.00, me, [me, rahul], 28, cat: "fun"),
            ex(cOmar, "Coffee & cake", 11.40, omar, [me, omar], 8),
        ]
        // a split that isn't even, and one between only some of the WG: opening them
        // to edit has to show them as they were saved
        var pizza = ex(flat, "Pizza night", 36, me, [me, jonas, mateo], 3)
        pizza.splitType = "percent"; pizza.split = SplitData(values: [me: 4000, jonas: 3000, mateo: 3000])
        allExpenses += [pizza, ex(flat, "Drinks", 18, sofia, [me, sofia, aiko], 3)]
        func act(_ id: String, _ f: String, _ by: String?, _ kind: String, _ what: String?, _ amt: Double? = nil, at: String, meta: [String: String] = [:]) -> Activity {
            Activity(id: "40000000-0000-4000-a000-0000000000" + id, flatId: f, actor: by, kind: kind, subject: what, amount: amt, at: at, meta: meta)
        }
        activity = [
            act("01", flat, sofia, "item_bought", "Oat milk", at: at(0, "08:40")),
            act("02", flat, jonas, "expense_added", "Rewe groceries", 64.20, at: at(2, "18:12")),
            act("03", flat, aiko, "chore_done", "Trash", at: at(1, "09:15")),
            act("04", trip, lea, "settled", "Priya Nair", 40, at: at(2, "20:02")),
            act("05", flat, mateo, "swap_asked", "Bathroom", at: at(2, "08:30"), meta: ["to": me]),
            act("06", flat, me, "expense_added", "Pizza night", 36, at: at(3, "21:20")),
            act("07", flat, sofia, "expense_added", "Drinks", 18, at: at(3, "22:05")),
            act("08", cSofia, me, "expense_added", "Sushi night", 46, at: at(5, "20:00")),
            act("09", flat, lea, "bill_paid", "Rent", 2_340, at: at(11, "10:00")),
            act("10", flat, aiko, "item_added", "Dish soap", at: at(6, "16:00")),
        ].sorted { $0.at > $1.at }
        allSettles = [
            Settlement(id: "s1", flatId: trip, fromUser: lea, toUser: me, amount: 40, settledOn: ago(2), currency: "EUR"),
            Settlement(id: "s2", flatId: family, fromUser: arjun, toUser: me, amount: 17.5, settledOn: ago(10), currency: "EUR"),
        ]
        flatId = flat
        members = allMembers.filter { $0.flatId == flat }
        expenses = allExpenses.filter { $0.flatId == flat }
        settles = allSettles.filter { $0.flatId == flat }
        bills = [
            Bill(id: "b1", flatId: flat, ownerId: nil, name: "Rent", amount: 2_340, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-01", payer: lea),
            Bill(id: "b2", flatId: flat, ownerId: nil, name: "Electricity", amount: 96, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-15", payer: me),
            Bill(id: "b3", flatId: flat, ownerId: nil, name: "Internet", amount: 39.99, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-12",
                 payer: me, contractEndsOn: "2026-12-31", noticeAmount: 1, noticeUnit: "month"),
            Bill(id: "b4", flatId: nil, ownerId: me, name: "Phone", amount: 20, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-03", payer: me),
            Bill(id: "b5", flatId: nil, ownerId: me, name: "Gym", amount: 29.9, currency: "EUR", category: "bills", cadence: "monthly", anchorOn: "2026-01-28", payer: me),
        ]
        billStatus = Dictionary(uniqueKeysWithValues: [
            BillStatus(billId: "b1", dueOn: ago(-19), state: "paid", paidOn: ago(11), paidBy: lea, cancelBy: nil),
            BillStatus(billId: "b2", dueOn: ago(0), state: "due", paidOn: nil, paidBy: nil, cancelBy: nil),
            BillStatus(billId: "b3", dueOn: ago(-3), state: "upcoming", paidOn: ago(30), paidBy: me, cancelBy: ago(-49)),
            BillStatus(billId: "b4", dueOn: ago(-6), state: "upcoming", paidOn: nil, paidBy: nil, cancelBy: nil),
            BillStatus(billId: "b5", dueOn: ago(-16), state: "paid", paidOn: ago(14), paidBy: me, cancelBy: nil),
        ].map { ($0.billId, $0) })
        let rota = wg
        chores = [
            Chore(id: "c1", flatId: flat, name: "Bathroom", cadence: "weekly", anchorOn: ago(63), points: 3, rota: rota),
            Chore(id: "c2", flatId: flat, name: "Kitchen", cadence: "weekly", anchorOn: ago(63), points: 2, rota: rota),
            Chore(id: "c3", flatId: flat, name: "Trash", cadence: "weekly", anchorOn: ago(63), points: 1, rota: rota),
            Chore(id: "c4", flatId: flat, name: "Vacuuming", cadence: "biweekly", anchorOn: ago(63), points: 2, rota: rota),
        ]
        // this week's turns: Monday to Sunday around today
        let wd = (cal.component(.weekday, from: today) + 5) % 7  // days since Monday
        let mon = ago(wd), sun = ago(wd - 6), nextMon = ago(wd - 7), nextSun = ago(wd - 13)
        func turn(_ c: String, _ n: Int, _ s: String, _ e: String, _ who: String, _ state: String = "open", by: String? = nil, pts: Int? = nil) -> ChoreTurn {
            ChoreTurn(choreId: c, n: n, flatId: flat, startsOn: s, endsOn: e, assignee: who, state: state, doneBy: by, doneAt: by == nil ? nil : at(1, "09:15"), points: pts)
        }
        choreTurns = [
            turn("c1", 9, mon, sun, me), turn("c1", 10, nextMon, nextSun, jonas),
            turn("c2", 9, mon, sun, sofia, "done", by: sofia, pts: 2), turn("c2", 10, nextMon, nextSun, me),
            turn("c3", 9, mon, sun, aiko, "done", by: aiko, pts: 1), turn("c3", 10, nextMon, nextSun, lea),
            turn("c4", 4, mon, nextSun, lea), turn("c4", 5, ago(wd - 14), ago(wd - 27), mateo),
        ]
        choreSwaps = [ChoreSwap(id: "w1", choreId: "c1", n: 9, flatId: flat, fromUser: mateo, toUser: me)]
        choresDone = [turn("c2", 9, mon, sun, sofia, "done", by: sofia, pts: 2), turn("c3", 9, mon, sun, aiko, "done", by: aiko, pts: 1),
                      turn("c1", 8, ago(wd + 7), ago(wd + 1), me, "done", by: me, pts: 3)]
        // a working student with two jobs this month (the tax estimate on the Work tab)
        profile.tax = TaxDetails()
        profile.jobs = ["Uni lab": JobSetting(kind: "werkstudent", main: true), "Café Mondo": JobSetting(kind: "minijob", main: false)]
        // two months of shifts: the lab on weekdays, the café some weekends
        shifts = [(1, "Uni lab", 8), (2, "Café Mondo", 5), (4, "Uni lab", 6), (8, "Uni lab", 8), (9, "Café Mondo", 6), (11, "Uni lab", 8),
                  (15, "Uni lab", 6), (16, "Café Mondo", 5), (22, "Uni lab", 8), (25, "Uni lab", 8), (30, "Café Mondo", 6), (36, "Uni lab", 8),
                  (39, "Uni lab", 6), (43, "Café Mondo", 5), (50, "Uni lab", 8), (53, "Uni lab", 8), (57, "Café Mondo", 6)].map { d, emp, h in
            var s = Shift(); s.date = ago(d); s.employer = emp; s.start = "09:00"; s.end = String(format: "%02d:00", 9 + h); s.wage = emp == "Uni lab" ? 15.5 : 13.9
            return s
        }
        // -HeimatTab home|groups|work and -HeimatGroup pick where it opens (screenshots); Groups otherwise
        let a = ProcessInfo.processInfo.arguments
        let start = a.firstIndex(of: "-HeimatTab").flatMap { $0 + 1 < a.count ? a[$0 + 1] : nil }
        tab = start == "home" ? .home : start == "work" ? .work : .flat
        if a.contains("-HeimatGroup") { tab = .flat; groupsPath = [.group(flat)] }
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
