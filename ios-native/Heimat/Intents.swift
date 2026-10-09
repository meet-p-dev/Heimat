import AppIntents
import CoreSpotlight
import Foundation
import Supabase

// Siri and the Shortcuts app. Every action here can run while Splitlife isn't on
// screen, so none of it goes through the app's views: it reads and writes through
// `SiriData`, which asks the server as the signed-in account (or, in demo mode, the
// demo data). What Siri says is worked out in SiriAnswers.swift, tested on its own.
// Anything that changes money asks first.

/// The categories Siri and the Shortcuts app can offer. Built-ins only: a
/// flat's custom categories live in the database and are not known to the
/// system at the time it builds its phrase list.
enum ExpenseCategory: String, AppEnum {
    case groceries, rent, utilities, internet, eatout, transport, household, other

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Category" }
    static var caseDisplayRepresentations: [ExpenseCategory: DisplayRepresentation] = [
        .groceries: "Groceries",
        .rent: "Rent",
        .utilities: "Utilities",
        .internet: "Internet",
        .eatout: "Eating out",
        .transport: "Transport",
        .household: "Household",
        .other: "Other",
    ]
}

/// The client an intent uses, and what the app keeps on the phone.
///
/// An intent can be run while Heimat is not on screen, so it cannot reach
/// `AppModel`. It builds its own client against the same auth storage key,
/// which means it picks up the session the app already signed in with.
enum IntentStore {
    static func client() -> SupabaseClient {
        SupabaseClient(
            supabaseURL: URL(string: Secrets.supabaseURL)!,
            supabaseKey: Secrets.supabaseKey,
            options: SupabaseClientOptions(auth: .init(storageKey: "heimat-auth", emitLocalSessionAsInitialSession: true))
        )
    }

    static var profile: Profile {
        UserDefaults.standard.data(forKey: "profile")
            .flatMap { try? JSONDecoder().decode(Profile.self, from: $0) } ?? Profile()
    }

    static func saveShifts(_ shifts: [Shift]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(shifts), forKey: "shifts")
    }

    static var shifts: [Shift] {
        UserDefaults.standard.data(forKey: "shifts")
            .flatMap { try? JSONDecoder().decode([Shift].self, from: $0) } ?? []
    }
}

// MARK: - What Siri reads and writes

enum SiriError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut, offline
    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut: "Open Splitlife and sign in first."
        case .offline: "Couldn't reach Splitlife. Check your connection and try again."
        }
    }
}

/// The signed-in account's groups, people, balances, chores and bills.
enum SiriData {
    struct Group: Hashable { var id: String; var name: String; var kind: String }
    struct Person: Hashable { var id: String; var name: String; var groups: [String] }

    #if DEBUG
    /// demo mode: the demo data of the running app, nothing from the server
    @MainActor static var demo: AppModel? { AppModel.fixtureMode ? Router.shared.model : nil }
    #endif

    private static func session() async throws -> (SupabaseClient, String) {
        let c = IntentStore.client()
        guard let uid = try? await c.auth.session.user.id.uuidString.lowercased() else { throw SiriError.signedOut }
        return (c, uid)
    }

    static func me() async throws -> String {
        #if DEBUG
        if let m = await demo { return await MainActor.run { m.uid ?? "" } }
        #endif
        return try await session().1
    }

    /// your groups (not the circles behind non-group expenses), oldest first
    static func groups() async throws -> [Group] {
        #if DEBUG
        if let m = await demo { return await MainActor.run { m.flats.map { Group(id: $0.id, name: $0.name, kind: $0.kind ?? "flat") } } }
        #endif
        let (c, uid) = try await session()
        struct M: Decodable { let flat_id: String }
        struct F: Decodable { let id: String; let name: String; let kind: String? }
        do {
            let mine: [M] = try await c.from("flat_members").select("flat_id").eq("user_id", value: uid).is("left_at", value: nil).execute().value
            guard !mine.isEmpty else { return [] }
            let flats: [F] = try await c.from("flats").select("id,name,kind").in("id", values: mine.map(\.flat_id)).order("created_at").execute().value
            return flats.filter { $0.kind != "direct" }.map { Group(id: $0.id, name: $0.name, kind: $0.kind ?? "flat") }
        } catch { throw SiriError.offline }
    }

    /// everyone you share a group with (not you), each with the groups you share
    static func people() async throws -> [Person] {
        #if DEBUG
        if let m = await demo {
            return await MainActor.run {
                let groups = Set(m.flats.map(\.id))
                var by: [String: Person] = [:]
                for mem in m.allMembers where mem.userId != m.uid && !mem.hasLeft && groups.contains(mem.flatId) {
                    by[mem.userId, default: Person(id: mem.userId, name: mem.displayName, groups: [])].groups.append(mem.flatId)
                }
                return by.values.sorted { $0.name < $1.name }
            }
        }
        #endif
        let (c, uid) = try await session()
        let groups = try await groups().map(\.id)
        guard !groups.isEmpty else { return [] }
        struct M: Decodable { let user_id: String; let display_name: String; let flat_id: String }
        do {
            let rows: [M] = try await c.from("flat_members").select("user_id,display_name,flat_id").in("flat_id", values: groups).is("left_at", value: nil).execute().value
            var by: [String: Person] = [:]
            for r in rows where r.user_id.lowercased() != uid {
                by[r.user_id, default: Person(id: r.user_id, name: r.display_name, groups: [])].groups.append(r.flat_id)
            }
            return by.values.sorted { $0.name < $1.name }
        } catch { throw SiriError.offline }
    }

    /// what you and each person owe each other, per place (positive: they owe you)
    static func balances() async throws -> [SiriAnswers.Line] {
        #if DEBUG
        if let m = await demo {
            let people = try await people()
            return await MainActor.run {
                people.flatMap { p in
                    m.lines(with: p.id).map { l in
                        SiriAnswers.Line(place: l.place, placeName: m.isCircle(l.place) ? "" : m.flatName(l.place),
                                         person: p.id, personName: p.name, currency: l.currency, minor: l.minor)
                    }
                }
            }
        }
        #endif
        let (c, _) = try await session()
        struct R: Decodable { let place: String; let place_name: String?; let place_kind: String?; let person: String; let person_name: String?; let currency: String; let minor: Int }
        do {
            let rows: [R] = try await c.rpc("my_pairwise").execute().value
            return rows.map { .init(place: $0.place, placeName: $0.place_kind == "direct" ? "" : ($0.place_name ?? ""),
                                    person: $0.person, personName: $0.person_name ?? "Someone", currency: $0.currency, minor: $0.minor) }
        } catch { throw SiriError.offline }
    }

    struct ChoreInfo: Hashable { var id: String; var name: String; var group: String }

    static func chores() async throws -> [ChoreInfo] {
        #if DEBUG
        if let m = await demo { return await MainActor.run { m.chores.map { ChoreInfo(id: $0.id, name: $0.name, group: m.flatName($0.flatId)) } } }
        #endif
        let (c, _) = try await session()
        struct R: Decodable { let id: String; let name: String; let flat_id: String }
        do {
            let rows: [R] = try await c.from("chores").select("id,name,flat_id").is("archived_at", value: nil).order("created_at").execute().value
            let names = Dictionary(try await groups().map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            return rows.map { ChoreInfo(id: $0.id, name: $0.name, group: names[$0.flat_id] ?? "") }
        } catch let e as SiriError { throw e } catch { throw SiriError.offline }
    }

    /// every chore's current and next turn, with names
    static func turns() async throws -> [SiriAnswers.Turn] {
        let chores = Dictionary(try await chores().map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let names = Dictionary(try await people().map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        var raw: [ChoreTurn] = []
        #if DEBUG
        if let m = await demo { raw = await MainActor.run { m.choreTurns } }
        #endif
        if raw.isEmpty {
            #if DEBUG
            if await demo != nil { return [] }
            #endif
            let (c, _) = try await session()
            do { raw = try await c.rpc("my_chores").execute().value } catch { throw SiriError.offline }
        }
        return raw.compactMap { t in
            guard let name = chores[t.choreId] else { return nil }
            return .init(chore: t.choreId, choreName: name, n: t.n, assignee: t.assignee,
                         assigneeName: t.assignee.flatMap { names[$0] }, state: t.state, startsOn: t.startsOn, endsOn: t.endsOn)
        }
    }

    struct BillInfo: Hashable { var id: String; var name: String; var minor: Int?; var currency: String; var dueOn: String?; var state: String? }

    /// your bills and where each stands
    static func bills() async throws -> [BillInfo] {
        var bills: [Bill] = [], status: [String: BillStatus] = [:]
        #if DEBUG
        if let m = await demo { (bills, status) = await MainActor.run { (m.bills, m.billStatus) } }
        #endif
        #if DEBUG
        let live = await demo == nil
        #else
        let live = true
        #endif
        if live {
            let (c, _) = try await session()
            do {
                bills = try await c.from("bills").select().is("archived_at", value: nil).order("created_at").execute().value
                let s: [BillStatus] = try await c.rpc("my_bills").execute().value
                status = Dictionary(s.map { ($0.billId, $0) }, uniquingKeysWith: { a, _ in a })
            } catch { throw SiriError.offline }
        }
        return bills.map { b in
            BillInfo(id: b.id, name: b.name, minor: b.amount.flatMap { Money.toMinor($0, b.currency) }, currency: b.currency,
                     dueOn: status[b.id]?.dueOn, state: status[b.id]?.state)
        }
    }

    /// The same row the app writes for an expense split equally: the split, the payers
    /// and the split type always sent (engine v2's protocol), null where they don't apply.
    static func addExpense(id: String, group: String, desc: String, amount: Double, currency: String,
                           paidBy: String, among: [String], category: String) async throws {
        #if DEBUG
        if let m = await demo { await m.show("Demo mode — nothing is saved"); return }
        #endif
        let (c, uid) = try await session()
        struct Row: Encodable {
            let id, flat_id, currency, created_by, description: String
            let amount: Double
            let paid_by: String
            let split_among: [String]
            let category, spent_on, split_type: String
            enum CodingKeys: CodingKey { case id, flat_id, currency, created_by, description, amount, paid_by, split_among, category, spent_on, split_type, split, payers }
            func encode(to encoder: Encoder) throws {
                var k = encoder.container(keyedBy: CodingKeys.self)
                try k.encode(id, forKey: .id); try k.encode(flat_id, forKey: .flat_id); try k.encode(currency, forKey: .currency)
                try k.encode(created_by, forKey: .created_by); try k.encode(description, forKey: .description); try k.encode(amount, forKey: .amount)
                try k.encode(paid_by, forKey: .paid_by); try k.encode(split_among, forKey: .split_among); try k.encode(category, forKey: .category)
                try k.encode(spent_on, forKey: .spent_on); try k.encode(split_type, forKey: .split_type)
                try k.encodeNil(forKey: .split); try k.encodeNil(forKey: .payers)   // null, not left out
            }
        }
        do {
            try await c.from("expenses").insert(Row(id: id, flat_id: group, currency: currency, created_by: uid, description: desc, amount: amount,
                                                    paid_by: paidBy, split_among: among, category: category, spent_on: Fmt.today(), split_type: "equal")).execute()
        } catch { throw SiriError.offline }
        await Router.shared.refresh()
    }

    static func tickBill(_ id: String, due: String) async throws {
        #if DEBUG
        if let m = await demo { await m.show("Demo mode — nothing is saved"); return }
        #endif
        let (c, _) = try await session()
        struct P: Encodable { let p_bill: String; let p_due: String; let p_paid: Bool }
        do { _ = try await c.rpc("tick_bill", params: P(p_bill: id, p_due: due, p_paid: true)).execute() } catch { throw SiriError.offline }
        await Router.shared.refresh()
    }

    static func tickChore(_ id: String, n: Int) async throws {
        #if DEBUG
        if let m = await demo { await m.show("Demo mode — nothing is saved"); return }
        #endif
        let (c, _) = try await session()
        struct P: Encodable { let p_chore: String; let p_n: Int; let p_done: Bool }
        do { _ = try await c.rpc("chore_tick", params: P(p_chore: id, p_n: n, p_done: true)).execute() } catch { throw SiriError.offline }
        await Router.shared.refresh()
    }

    static func money(_ minor: Int, _ cur: String) -> String { Fmt.money(Money.toMajor(minor, cur), cur) }
    static func day(_ ymd: String) -> String { Fmt.relDay(ymd) }
}

// MARK: - Things Siri can name

/// A group: "Add 20 euros to Münchener Straße", and in iPhone search.
struct GroupEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Group" }
    static var defaultQuery = GroupQuery()
    var id: String
    var name: String
    var kind: String
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: kind == "flat" ? "Shared flat" : "Group", image: .init(systemName: kind == "flat" ? "house.fill" : "person.3.fill"))
    }
    init(_ g: SiriData.Group) { id = g.id; name = g.name; kind = g.kind }
}

struct GroupQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [GroupEntity] {
        try await SiriData.groups().filter { identifiers.contains($0.id) }.map(GroupEntity.init)
    }
    func entities(matching string: String) async throws -> [GroupEntity] {
        try await SiriData.groups().filter { $0.name.localizedCaseInsensitiveContains(string) }.map(GroupEntity.init)
    }
    func suggestedEntities() async throws -> [GroupEntity] { try await SiriData.groups().map(GroupEntity.init) }
}

/// Someone you share a group with: "How much do I owe Kevin?"
struct PersonEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Person" }
    static var defaultQuery = PersonQuery()
    var id: String
    var name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", image: .init(systemName: "person.crop.circle.fill")) }
    init(_ p: SiriData.Person) { id = p.id; name = p.name }
}

struct PersonQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [PersonEntity] {
        try await SiriData.people().filter { identifiers.contains($0.id) }.map(PersonEntity.init)
    }
    func entities(matching string: String) async throws -> [PersonEntity] {
        // "Kevin" finds "Kevin Müller"; first names first
        try await SiriData.people().filter { $0.name.localizedCaseInsensitiveContains(string) }.map(PersonEntity.init)
    }
    func suggestedEntities() async throws -> [PersonEntity] { try await SiriData.people().map(PersonEntity.init) }
}

/// A chore on a rota: "Whose turn is it for the bathroom?"
struct ChoreEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Chore" }
    static var defaultQuery = ChoreQuery()
    var id: String
    var name: String
    var group: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(group)", image: .init(systemName: "sparkles")) }
    init(_ c: SiriData.ChoreInfo) { id = c.id; name = c.name; group = c.group }
}

struct ChoreQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ChoreEntity] {
        try await SiriData.chores().filter { identifiers.contains($0.id) }.map(ChoreEntity.init)
    }
    func entities(matching string: String) async throws -> [ChoreEntity] {
        try await SiriData.chores().filter { $0.name.localizedCaseInsensitiveContains(string) }.map(ChoreEntity.init)
    }
    func suggestedEntities() async throws -> [ChoreEntity] { try await SiriData.chores().map(ChoreEntity.init) }
}

/// A bill: "Mark rent as paid."
struct BillEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Bill" }
    static var defaultQuery = BillQuery()
    var id: String
    var name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", image: .init(systemName: "doc.text.fill")) }
    init(_ b: SiriData.BillInfo) { id = b.id; name = b.name }
}

struct BillQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [BillEntity] {
        try await SiriData.bills().filter { identifiers.contains($0.id) }.map(BillEntity.init)
    }
    func entities(matching string: String) async throws -> [BillEntity] {
        try await SiriData.bills().filter { $0.name.localizedCaseInsensitiveContains(string) }.map(BillEntity.init)
    }
    func suggestedEntities() async throws -> [BillEntity] { try await SiriData.bills().map(BillEntity.init) }
}

// MARK: - Actions

/// "I paid 42 euros at Lidl, split with Kai and Alex." Split equally, paid by you —
/// in the group you name, or your only one; asked for when you have several.
struct AddExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Add an expense"
    static var description = IntentDescription("Adds an expense you paid, split equally in one of your groups.")
    /// The work happens in the background — no reason to make you look at the app.
    static var openAppWhenRun = false

    @Parameter(title: "Amount", requestValueDialog: "How much was it?")
    var amount: Double

    @Parameter(title: "What for?", requestValueDialog: "What was it for?")
    var note: String?

    @Parameter(title: "Group", requestValueDialog: "Which group is it for?")
    var group: GroupEntity?

    @Parameter(title: "Split with", requestValueDialog: "Who is it split with?")
    var people: [PersonEntity]?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$amount) to \(\.$group)") {
            \.$note
            \.$people
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let currency = IntentStore.profile.hostCur
        guard amount > 0, let minor = Money.toMinor(amount, currency), minor > 0, minor < 100_000_000 else {
            return .result(dialog: "That amount doesn't look right.")
        }
        let me = try await SiriData.me()
        // which group: the one named, or the only one
        let groups = try await SiriData.groups()
        guard !groups.isEmpty else { return .result(dialog: "You're not in a group yet, so there's nobody to split with.") }
        let target: SiriData.Group
        if let group, let g = groups.first(where: { $0.id == group.id }) { target = g }
        else if groups.count == 1 { target = groups[0] }
        else { throw $group.needsValueError("Which group is it for?") }

        // who: everyone in the group, or the people named — and you
        let all = try await SiriData.people().filter { $0.groups.contains(target.id) }
        var among = all
        if let picked = people, !picked.isEmpty {
            let outside = picked.filter { p in !all.contains { $0.id == p.id } }
            if let first = outside.first { return .result(dialog: "\(first.name) isn't in \(target.name).") }
            among = all.filter { p in picked.contains { $0.id == p.id } }
        }
        let ids = ([me] + among.map(\.id)).sorted(by: Ledger.less)
        let what = note?.trimmingCharacters(in: .whitespaces) ?? ""
        let names = SiriAnswers.joined(["you"] + among.map(\.name))
        let money = SiriData.money(minor, currency)
        try await requestConfirmation(actionName: .add,
                                      dialog: "Add \(money)\(what.isEmpty ? "" : " for \(what)") to \(target.name), split equally between \(names)?")
        try await SiriData.addExpense(id: UUID().uuidString.lowercased(), group: target.id, desc: what, amount: Money.toMajor(minor, currency),
                                      currency: currency, paidBy: me, among: ids, category: Suggest.builtin(what) ?? "other")
        return .result(dialog: "Added \(money) to \(target.name).")
    }
}

/// "How much do I owe Kevin?" — or "Who owes me?" with no one named.
struct BalanceIntent: AppIntent {
    static var title: LocalizedStringResource = "Check balances"
    static var description = IntentDescription("Says what you owe someone, or what they owe you, across your groups.")
    static var openAppWhenRun = false

    @Parameter(title: "Person")
    var person: PersonEntity?

    static var parameterSummary: some ParameterSummary { Summary("Balance with \(\.$person)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let lines = try await SiriData.balances()
        let text = SiriAnswers.balance(lines, person: person?.id, personName: person?.name, money: SiriData.money)
        return .result(dialog: "\(text)")
    }
}

/// "Whose turn is it for the bathroom?" — or "What are my chores?"
struct ChoreTurnIntent: AppIntent {
    static var title: LocalizedStringResource = "Whose turn is it"
    static var description = IntentDescription("Says whose turn a chore is, or which chores are yours.")
    static var openAppWhenRun = false

    @Parameter(title: "Chore")
    var chore: ChoreEntity?

    static var parameterSummary: some ParameterSummary { Summary("Whose turn for \(\.$chore)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let turns = try await SiriData.turns()
        let text = SiriAnswers.turn(turns, chore: chore?.id, me: try await SiriData.me(), today: Fmt.today(), day: SiriData.day)
        return .result(dialog: "\(text)")
    }
}

/// "I did the bathroom." Ticks your current turn of a chore.
struct ChoreDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a chore done"
    static var description = IntentDescription("Ticks off your turn of a chore.")
    static var openAppWhenRun = false

    @Parameter(title: "Chore", requestValueDialog: "Which chore?")
    var chore: ChoreEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let me = try await SiriData.me()
        let now = try await SiriData.turns().filter { $0.chore == chore.id }.min { $0.n < $1.n }
        guard let now else { return .result(dialog: "\(chore.name) has no one on its rota yet.") }
        if now.state == "done" { return .result(dialog: "\(chore.name) is already done for this time.") }
        guard now.assignee == me else {
            return .result(dialog: "It's \(now.assigneeName ?? "someone else")'s turn for \(chore.name) — open Splitlife to say you did it anyway.")
        }
        try await SiriData.tickChore(chore.id, n: now.n)
        return .result(dialog: "Done — \(chore.name) is ticked off.")
    }
}

/// "What bills are due?"
struct BillsDueIntent: AppIntent {
    static var title: LocalizedStringResource = "Bills due"
    static var description = IntentDescription("Says which bills are overdue or due, or when the next one is.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let bills = try await SiriData.bills().compactMap { b -> SiriAnswers.BillDue? in
            guard let due = b.dueOn, let state = b.state else { return nil }
            return .init(name: b.name, minor: b.minor, currency: b.currency, dueOn: due, state: state)
        }
        return .result(dialog: "\(SiriAnswers.bills(bills, money: SiriData.money, day: SiriData.day))")
    }
}

/// "Mark rent as paid." The oldest unpaid due date of that bill, after asking.
struct BillPaidIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a bill paid"
    static var description = IntentDescription("Marks the bill's oldest unpaid due date as paid.")
    static var openAppWhenRun = false

    @Parameter(title: "Bill", requestValueDialog: "Which bill?")
    var bill: BillEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let b = try await SiriData.bills().first(where: { $0.id == bill.id }), let due = b.dueOn else {
            return .result(dialog: "Couldn't find that bill.")
        }
        if b.state == "paid" { return .result(dialog: "\(b.name) is already paid — next due \(SiriAnswers.when(SiriData.day(due))).") }
        let amount = b.minor.map { " (\(SiriData.money($0, b.currency)))" } ?? ""
        try await requestConfirmation(dialog: "Mark \(b.name)\(amount), due \(SiriAnswers.when(SiriData.day(due))), as paid?")
        try await SiriData.tickBill(b.id, due: due)
        return .result(dialog: "Done — \(b.name) is marked paid.")
    }
}

/// "Log a shift in Heimat." Shifts are personal, so this never leaves the phone.
struct LogShiftIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a work shift"
    static var description = IntentDescription("Records hours worked, on this phone.")
    static var openAppWhenRun = false

    @Parameter(title: "Hours", requestValueDialog: "How many hours?")
    var hours: Double

    @Parameter(title: "Employer")
    var employer: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$hours) hours in Splitlife") { \.$employer }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard hours > 0, hours <= 24 else {
            return .result(dialog: "That doesn't look like a shift length.")
        }
        let existing = await Router.shared.model?.shifts ?? IntentStore.shifts
        var shift = Shift()
        shift.date = Fmt.today()
        shift.employer = employer?.trimmingCharacters(in: .whitespaces) ?? ""
        shift.hours = hours
        // carry the last wage forward, so pay is right without being asked
        shift.wage = existing.sorted { $0.date < $1.date }.last?.wage ?? 0

        // When Heimat is running it owns this array in memory and rewrites the
        // whole thing on any change, so go through it rather than behind it.
        let logged = shift
        if let model = await Router.shared.model {
            await MainActor.run { model.saveShift(logged) }
        } else {
            IntentStore.saveShifts(existing + [logged])
        }
        return .result(dialog: "Logged \(Fmt.num(hours)) hours.")
    }
}

/// Opens Heimat on the new-expense sheet — what a widget button will run.
struct OpenAddExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Open new expense"
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        await Router.shared.go(.addExpense)
        return .result()
    }
}

/// A group picked in iPhone search (or Shortcuts): open its page.
struct OpenGroupIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open group"
    @Parameter(title: "Group")
    var target: GroupEntity

    func perform() async throws -> some IntentResult {
        await Router.shared.go(.group(target.id))
        return .result()
    }
}

/// Where an intent asks the app to go: straight there when it is running, or as soon
/// as it has started.
@MainActor
final class Router {
    static let shared = Router()
    enum Destination { case addExpense, group(String) }
    private var pending: Destination?
    /// Set while Heimat is on screen, so an intent can go through the running
    /// app instead of writing behind its back.
    weak var model: AppModel? { didSet { if let p = pending { pending = nil; go(p) } } }

    func go(_ d: Destination) {
        guard let m = model else { pending = d; return }
        switch d {
        case .addExpense: m.startAddExpense()
        case .group(let id):
            m.sheet = nil
            m.switchFlat(id); m.tab = .flat; m.groupsPath = [.group(id)]
        }
    }

    /// something changed on the server: the running app picks it up now
    func refresh() async { await model?.refreshAfterSiri() }
}

extension AppModel {
    /// Siri added an expense or ticked a bill or chore while the app was open
    func refreshAfterSiri() async {
        await loadFlat(); await loadBills(); await loadChores()
    }

    /// your groups in iPhone search: type "Münchener" to open it
    func indexForSearch() {
        let groups = flats.map { GroupEntity(SiriData.Group(id: $0.id, name: $0.name, kind: $0.kind ?? "flat")) }
        Task.detached {
            try? await CSSearchableIndex.default().deleteAppEntities(ofType: GroupEntity.self)
            try? await CSSearchableIndex.default().indexAppEntities(groups)
        }
        // the phrases that name a group or person know the new ones
        HeimatShortcuts.updateAppShortcutParameters()
    }
}

/// The phrases Siri knows without the user setting anything up. Each has to name
/// the app; one with a group, person, chore or bill in it is offered for each.
struct HeimatShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddExpenseIntent(),
            phrases: [
                "Add an expense in \(.applicationName)",
                "Split an expense in \(.applicationName)",
            ],
            shortTitle: "Add expense",
            systemImageName: "plus.circle.fill"
        )
        AppShortcut(
            intent: BalanceIntent(),
            phrases: [
                "Who owes me in \(.applicationName)",
                "How much do I owe in \(.applicationName)",
                "What do I owe \(\.$person) in \(.applicationName)",
                "How much does \(\.$person) owe me in \(.applicationName)",
            ],
            shortTitle: "Balances",
            systemImageName: "eurosign.circle.fill"
        )
        AppShortcut(
            intent: ChoreTurnIntent(),
            phrases: [
                "Whose turn is it in \(.applicationName)",
                "What are my chores in \(.applicationName)",
                "Whose turn is \(\.$chore) in \(.applicationName)",
            ],
            shortTitle: "Whose turn",
            systemImageName: "sparkles"
        )
        AppShortcut(
            intent: ChoreDoneIntent(),
            phrases: [
                "Mark a chore done in \(.applicationName)",
                "I did \(\.$chore) in \(.applicationName)",
            ],
            shortTitle: "Chore done",
            systemImageName: "checkmark.circle.fill"
        )
        AppShortcut(
            intent: BillsDueIntent(),
            phrases: [
                "What bills are due in \(.applicationName)",
                "Which bills do I have to pay in \(.applicationName)",
            ],
            shortTitle: "Bills due",
            systemImageName: "doc.text.fill"
        )
        AppShortcut(
            intent: BillPaidIntent(),
            phrases: [
                "Mark a bill paid in \(.applicationName)",
                "Mark \(\.$bill) as paid in \(.applicationName)",
            ],
            shortTitle: "Bill paid",
            systemImageName: "checkmark.seal.fill"
        )
        // a group from iPhone search opens it (the phrase that names a group is this one)
        AppShortcut(
            intent: OpenGroupIntent(),
            phrases: ["Open \(\.$target) in \(.applicationName)"],
            shortTitle: "Open group",
            systemImageName: "person.3.fill"
        )
        AppShortcut(
            intent: LogShiftIntent(),
            phrases: [
                "Log a shift in \(.applicationName)",
                "Log work hours in \(.applicationName)",
            ],
            shortTitle: "Log shift",
            systemImageName: "clock.fill"
        )
    }
}
