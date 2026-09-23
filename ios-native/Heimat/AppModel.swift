import Foundation
import SwiftUI
import Supabase
import WidgetKit

/// All of Heimat's state. The shared half (flats, expenses, settlements, the
/// list, categories) lives in Supabase and syncs live; the personal half
/// (profile, shifts, settings) stays on the phone, as it always has.
@MainActor
@Observable
final class AppModel {
    // navigation
    var tab: AppTab = .home
    var sheet: SheetRoute?
    var toast: String?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    // personal, persisted on the device
    var profile: Profile { didSet { save(profile, "profile") } }
    var prefs: Prefs { didSet { save(prefs, "prefs"); Haptic.on = prefs.haptics } }
    var shifts: [Shift] { didSet { save(shifts, "shifts") } }

    // account
    var uid: String?
    var isAnon = true
    var email: String?
    var pendingEmail: String?
    var accountName: String?
    var authError: String?

    // the shared flat
    var flats: [Flat] = []
    var flatId: String? { didSet { UserDefaults.standard.set(flatId, forKey: "flatId") } }
    var members: [Member] = []
    /// the same three tables across every flat you belong to, for Home
    var activity: [Activity] = []
    var allMembers: [Member] = []
    var allExpenses: [Expense] = []
    var allSettles: [Settlement] = []
    var expenses: [Expense] = []
    var settles: [Settlement] = []
    var items: [ListItem] = []
    var flatCats: [FlatCategory] = []

    @ObservationIgnored let client: SupabaseClient
    @ObservationIgnored private var channel: RealtimeChannelV2?
    @ObservationIgnored private var listenTask: Task<Void, Never>?
    @ObservationIgnored private var authTask: Task<Void, Never>?
    @ObservationIgnored private var legacyTokens: (String, String)?

    init() {
        client = SupabaseClient(
            supabaseURL: URL(string: Secrets.supabaseURL)!,
            supabaseKey: Secrets.supabaseKey,
            options: SupabaseClientOptions(auth: .init(storageKey: "heimat-auth", emitLocalSessionAsInitialSession: true))
        )
        profile = Self.load("profile") ?? Profile()
        prefs = Self.load("prefs") ?? Prefs()
        shifts = Self.load("shifts") ?? []
        flatId = UserDefaults.standard.string(forKey: "flatId")
        Haptic.on = prefs.haptics
    }

    // MARK: derived

    var flat: Flat? { flats.first { $0.id == flatId } }
    /// the places you live, and the people you only split with
    var homeFlats: [Flat] { flats.filter { !$0.isGroup } }
    var groups: [Flat] { flats.filter { $0.isGroup } }
    var cats: [Cat] { Cats.merged(flatCats) }
    /// Who is actually in the flat now. `members` keeps everyone who ever was,
    /// because the balance maths and every past expense still need their name.
    var roster: [Member] { members.filter { !$0.hasLeft } }
    /// the roster, plus anyone who left still carrying a balance
    var balanceRoster: [Member] {
        let b = balances
        return members.filter { !$0.hasLeft || abs(b[$0.userId] ?? 0) > 0.005 }
    }
    var balances: [String: Double] { Calc.balances(members: members, expenses: expenses, settles: settles) }
    var myNet: Double { uid.flatMap { balances[$0] } ?? 0 }

    // MARK: everything, not just the flat you happen to be looking at
    //
    // Home answers "where do I stand", which spans every flat and group at
    // once — so these are loaded across all of them, and the per-person
    // figures are pairwise (see Calc.pairwise) rather than per-flat nets,
    // which cannot be added together.

    struct Standing: Identifiable {
        let person: Member
        let amount: Double        // positive: they owe you
        let flats: [String]       // where the two of you share money
        var id: String { person.userId }
    }

    var standings: [Standing] {
        guard let uid else { return [] }
        let net = Calc.pairwise(mine: uid, expenses: allExpenses, settles: allSettles)
        return net.compactMap { id, amount -> Standing? in
            guard let person = allMembers.first(where: { $0.userId == id }) else { return nil }
            let names = allMembers
                .filter { $0.userId == id }
                .compactMap { mem in flats.first { $0.id == mem.flatId }?.name }
            return Standing(person: person, amount: amount, flats: names.sorted())
        }
        .sorted { abs($0.amount) > abs($1.amount) }
    }

    var owedToMe: Double { standings.filter { $0.amount > 0 }.reduce(0) { $0 + $1.amount } }
    var iOwe: Double { standings.filter { $0.amount < 0 }.reduce(0) { $0 - $1.amount } }
    var overallNet: Double { owedToMe - iOwe }

    /// the people in one flat, from the overview rather than the open flat
    func members(of flatId: String) -> [Member] { allMembers.filter { $0.flatId == flatId && !$0.hasLeft } }
    func flatName(_ id: String) -> String { flats.first { $0.id == id }?.name ?? "" }
    var work: Calc.WorkStats { Calc.work(shifts, weekCap: prefs.weekCap, yearDays: prefs.yearDays) }
    var hostCur: String { profile.hostCur }
    var homeCur: String { profile.homeCur }
    var firstName: String { String(profile.name.split(separator: " ").first ?? "") }
    var openItems: Int { items.filter { !$0.bought }.count }
    var earnedTotal: Double { shifts.reduce(0) { $0 + Calc.shift($1).pay } }
    var spentTotal: Double { Calc.myShare(expenses, uid: uid) }
    private var displayName: String { profile.name.isEmpty ? "Me" : profile.name }

    /// expenses arrive newest first, so each month is one contiguous run
    var months: [(key: String, label: String, total: Double, list: [Expense])] {
        var out: [(key: String, label: String, total: Double, list: [Expense])] = []
        for e in expenses {
            let k = String(e.spentOn.prefix(7))
            if out.last?.key != k { out.append((k, Fmt.monthLabel(e.spentOn), 0, [])) }
            out[out.count - 1].list.append(e)
            out[out.count - 1].total += e.amount
        }
        return out
    }

    func fH(_ v: Double) -> String { Fmt.money(v, hostCur) }
    func fHome(_ v: Double) -> String? { homeCur == hostCur ? nil : Fmt.money(v * profile.rate, homeCur) }
    func nameOf(_ u: String) -> String { u == uid ? "You" : members.first { $0.userId == u }?.displayName ?? "Someone" }
    /// the same, for a flat other than the one you have open
    func nameOf(_ u: String, in flat: String) -> String {
        if u == uid { return "You" }
        return allMembers.first { $0.flatId == flat && $0.userId == u }?.displayName
            ?? members.first { $0.userId == u }?.displayName ?? "Someone"
    }
    /// you can edit an expense you added, or one someone else logged but you paid for
    func canEdit(_ e: Expense) -> Bool { e.createdBy == uid || e.paidBy == uid }
    func open(_ e: Expense) { Haptic.tap(); sheet = canEdit(e) ? .expense(e, nil) : .expenseDetail(e) }
    func startAddExpense(prefill: ExpensePrefill? = nil) { sheet = .expense(nil, prefill) }

    func show(_ t: String) {
        toast = t
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.6))
            if !Task.isCancelled { self?.toast = nil }
        }
    }

    // MARK: launch

    func start() async {
        if let legacy = await LegacyImport.run() { adopt(legacy) }
        do {
            if client.auth.currentSession == nil, let (a, r) = legacyTokens {
                _ = try? await client.auth.setSession(accessToken: a, refreshToken: r)
            }
            if client.auth.currentSession == nil { try await client.auth.signInAnonymously() }
            apply(try await client.auth.session.user)
            authError = nil
        } catch {
            authError = error.localizedDescription
        }
        let auth = client.auth
        authTask = Task { [weak self] in
            for await change in auth.authStateChanges {
                if let u = change.session?.user { self?.apply(u) }
            }
        }
        await loadMyFlats()
        if prefs.autoRate && homeCur != hostCur && profile.rateAt != Fmt.today() { _ = await refreshRate() }
    }

    /// what the Capacitor build left behind — see LegacyImport
    private func adopt(_ r: LegacyImport.Result) {
        if let p = r.profile, !profile.onboarded { profile = p }
        if let s = r.shifts, shifts.isEmpty { shifts = s }
        if let pr = r.prefs { prefs = pr }
        if let f = r.flatId, flatId == nil { flatId = f }
        if let a = r.accessToken, let t = r.refreshToken { legacyTokens = (a, t) }
    }

    private func apply(_ user: User) {
        uid = user.id.uuidString.lowercased()
        isAnon = user.isAnonymous
        email = user.email
        pendingEmail = user.newEmail
    }

    // MARK: flat data

    func reload() async { await loadMyFlats() }

    func loadMyFlats() async {
        guard let uid else { return }
        do {
            struct Row: Decodable { let flat_id: String }
            let mem: [Row] = try await client.from("flat_members").select("flat_id").eq("user_id", value: uid).execute().value
            let ids = Array(Set(mem.map(\.flat_id)))
            guard !ids.isEmpty else { flats = []; flatId = nil; clearFlat(); return }
            flats = try await client.from("flats").select().in("id", values: ids).execute().value
            if flatId == nil || !flats.contains(where: { $0.id == flatId }) { flatId = flats.first?.id }
            await loadFlat()
            subscribe()
        } catch {
            show("Sync error — pull down to retry")
        }
    }

    func loadFlat() async {
        guard let id = flatId else { clearFlat(); return }
        do {
            async let m: [Member] = client.from("flat_members").select().eq("flat_id", value: id).execute().value
            async let e: [Expense] = client.from("expenses").select().eq("flat_id", value: id).order("spent_on", ascending: false).execute().value
            async let s: [Settlement] = client.from("settlements").select().eq("flat_id", value: id).execute().value
            async let it: [ListItem] = client.from("flat_items").select().eq("flat_id", value: id).order("created_at", ascending: true).execute().value
            async let c: [FlatCategory] = client.from("flat_categories").select().eq("flat_id", value: id).order("created_at", ascending: true).execute().value
            (members, expenses, settles, items, flatCats) = try await (m, e, s, it, c)
        } catch {
            show("Sync error — pull down to retry")
        }
        // Home spans every flat, so it has to follow the same refreshes —
        // including the ones realtime triggers for the flat you have open
        await loadOverview()
    }

    /// Three queries for all of your flats at once rather than three per flat.
    /// Home needs the lot; the Flat tab still works off the open flat's own
    /// copies, which realtime keeps fresher.
    func loadOverview() async {
        let ids = flats.map(\.id)
        guard !ids.isEmpty else { allMembers = []; allExpenses = []; allSettles = []; return }
        do {
            async let m: [Member] = client.from("flat_members").select().in("flat_id", values: ids).execute().value
            async let e: [Expense] = client.from("expenses").select().in("flat_id", values: ids).order("spent_on", ascending: false).execute().value
            async let s: [Settlement] = client.from("settlements").select().in("flat_id", values: ids).execute().value
            (allMembers, allExpenses, allSettles) = try await (m, e, s)
        } catch {
            // Home falls back to showing nothing rather than something wrong
            allMembers = []; allExpenses = []; allSettles = []
        }
    }

    private func clearFlat() { members = []; expenses = []; settles = []; items = []; flatCats = []; activity = [] }

    /// Only fetched when the History sheet is opened — it is the one thing
    /// here that grows without bound and nothing else on screen needs it.
    func loadActivity() async {
        guard let id = flatId else { return }
        activity = (try? await client.from("activity").select()
            .eq("flat_id", value: id).order("at", ascending: false).limit(300)
            .execute().value) ?? []
    }

    func switchFlat(_ id: String) {
        guard id != flatId else { return }
        Haptic.tap()
        flatId = id
        clearFlat()
        Task { await loadFlat(); subscribe() }
    }

    /// live updates for the current flat; a flatmate's new expense also shows a toast
    private func subscribe() {
        listenTask?.cancel()
        let old = channel
        guard let id = flatId else { channel = nil; return }
        let ch = client.channel("flat-\(id)")
        channel = ch
        let expenses = ch.postgresChange(AnyAction.self, schema: "public", table: "expenses", filter: .eq("flat_id", value: id))
        let others = ["settlements", "flat_members", "flat_items", "flat_categories"].map {
            ch.postgresChange(AnyAction.self, schema: "public", table: $0, filter: .eq("flat_id", value: id))
        }
        let client = client
        listenTask = Task { [weak self] in
            if let old { await client.removeChannel(old) }
            try? await ch.subscribeWithError()
            await withTaskGroup(of: Void.self) { g in
                g.addTask {
                    for await change in expenses {
                        if case .insert(let a) = change, let e = try? a.decodeRecord(as: Expense.self, decoder: JSONDecoder()) {
                            await self?.announce(e)
                        }
                        await self?.loadFlat()
                    }
                }
                for s in others { g.addTask { for await _ in s { await self?.loadFlat() } } }
            }
        }
    }

    private func announce(_ e: Expense) {
        guard e.createdBy != uid, let who = e.createdBy else { return }
        let mine = uid.map { e.parts.contains($0) } ?? false
        show("\(nameOf(who)) added \(Fmt.money(e.amount, e.currency))" + (mine ? " · you owe \(Fmt.money(e.share, e.currency))" : ""))
        Haptic.tap()
    }

    func createFlat(_ name: String) async -> Bool {
        do {
            let f: Flat = try await client.rpc("create_flat", params: ["p_name": name, "p_display_name": displayName]).execute().value
            flatId = f.id
            Haptic.success()
            await loadMyFlats()
            show("Flat created — invite your flatmates")
            return true
        } catch {
            show("Couldn't create the flat — try again")
            return false
        }
    }

    func joinFlat(_ code: String) async -> Bool {
        do {
            let f: Flat = try await client.rpc("join_flat", params: ["p_code": code.trimmingCharacters(in: .whitespaces).uppercased(), "p_display_name": displayName]).execute().value
            flatId = f.id
            Haptic.success()
            await loadMyFlats()
            show("Joined \(f.name)")
            return true
        } catch {
            show("That code didn't match a flat — check it and try again")
            return false
        }
    }

    func createGroup(_ name: String) async -> Bool {
        do {
            let f: Flat = try await client.rpc("create_group", params: ["p_name": name, "p_display_name": displayName]).execute().value
            flatId = f.id
            Haptic.success()
            await loadMyFlats()
            show("Group created — add the people you're splitting with")
            return true
        } catch {
            show("Couldn't create the group — try again")
            return false
        }
    }

    /// Adds someone by email. If they already have a Heimat account they are in
    /// straight away; if not they become a pending member — their share counts
    /// from now on, and the invite email tells them where to claim it.
    @discardableResult
    func invite(email: String, name: String) async -> String? {
        guard let id = flatId else { return "No flat open" }
        struct Params: Encodable { let p_flat: String, p_email: String, p_name: String }
        do {
            let row: Member = try await client.rpc("invite_member", params: Params(
                p_flat: id, p_email: email.trimmingCharacters(in: .whitespaces), p_name: name.trimmingCharacters(in: .whitespaces)
            )).execute().value
            Haptic.success()
            await loadFlat()
            // whether the email got there is the invite function's business and
            // it hasn't reported yet — the sheet says so once it has
            show(row.isPending ? "Invited \(row.displayName)" : "\(row.displayName) is in")
            return nil
        } catch {
            return friendly(error, "Couldn't add them right now. Please try again in a minute.")
        }
    }

    /// Takes someone out of the flat. The database refuses while they are up
    /// or down, because a debt that vanishes with the person is worse than the
    /// conversation about removing them.
    func remove(_ member: Member) async {
        guard let id = flatId else { return }
        struct P: Encodable { let p_flat: String, p_uid: String }
        do {
            _ = try await client.rpc("remove_member", params: P(p_flat: id, p_uid: member.userId)).execute()
            Haptic.success()
            await loadFlat()
            show("\(member.displayName) is no longer in the flat")
        } catch {
            show(raised(error) ?? friendly(error, "Couldn't remove them right now."))
        }
    }

    /// A reminder to whoever owes you. Once a day each, because it is much
    /// easier to send than to say.
    func nudge(_ member: Member) async {
        guard let id = flatId else { return }
        struct P: Encodable { let p_flat: String, p_uid: String }
        do {
            _ = try await client.rpc("nudge", params: P(p_flat: id, p_uid: member.userId)).execute()
            Haptic.success()
            show("Reminded \(member.displayName)")
        } catch {
            show(raised(error) ?? friendly(error, "Couldn't send that reminder."))
        }
    }

    func revokeInvite(_ memberId: String) async {
        do {
            _ = try await client.rpc("revoke_invite", params: ["p_member": memberId]).execute()
            await loadFlat()
            show("Invite removed")
        } catch {
            show("Couldn't remove that invite")
        }
    }

    /// Opening an invite link. The database also hands out anything addressed
    /// to your email the moment you sign up, so this is for jumping straight
    /// to the group you were invited to.
    func claimInvite(_ token: String) async {
        do {
            let f: Flat = try await client.rpc("claim_invite", params: ["p_token": token]).execute().value
            await loadMyFlats()
            switchFlat(f.id)
            tab = .flat
            Haptic.success()
            show("You're in \(f.name)")
        } catch {
            show("That invite has already been used")
        }
    }

    /// Anything that was waiting for this address before we knew it.
    private func claimWaitingInvites() async {
        _ = try? await client.rpc("claim_invites").execute()
    }

    func leaveFlat() async {
        guard let id = flatId else { return }
        _ = try? await client.rpc("leave_flat", params: ["p_flat": id]).execute()
        flatId = nil
        clearFlat()
        await loadMyFlats()
        show("Left the flat")
    }

    // MARK: expenses & settling

    private struct NewExpense: Encodable {
        let flat_id: String, description: String, amount: Double, currency: String, paid_by: String
        let split_among: [String], category: String, created_by: String?, spent_on: String
    }
    private struct ExpenseChange: Encodable {
        let description: String, amount: Double, paid_by: String, split_among: [String], category: String, spent_on: String
    }

    func addExpense(_ d: ExpenseDraft) async {
        // the draft carries its own flat: Home can add to any of them
        guard let id = d.flatId ?? flatId else { return }
        await run("Expense added") {
            try await self.client.from("expenses").insert(NewExpense(flat_id: id, description: d.desc, amount: d.amount, currency: self.hostCur, paid_by: d.paidBy,
                                                                     split_among: d.among, category: d.category, created_by: self.uid, spent_on: d.spentOn)).execute()
        }
    }

    func updateExpense(_ id: String, _ d: ExpenseDraft) async {
        await run("Expense updated") {
            try await self.client.from("expenses").update(ExpenseChange(description: d.desc, amount: d.amount, paid_by: d.paidBy, split_among: d.among,
                                                                        category: d.category, spent_on: d.spentOn)).eq("id", value: id).execute()
        }
    }

    func deleteExpense(_ id: String) async {
        await run("Expense deleted") { try await self.client.from("expenses").delete().eq("id", value: id).execute() }
    }

    func settleUp(from: String, to: String, amount: Double) async {
        guard let id = flatId else { return }
        struct Row: Encodable { let flat_id, from_user, to_user: String; let amount: Double; let created_by: String?; let settled_on: String }
        await run("Payment recorded") {
            try await self.client.from("settlements").insert(Row(flat_id: id, from_user: from, to_user: to, amount: amount, created_by: self.uid, settled_on: Fmt.today())).execute()
        }
    }

    // MARK: shopping list & categories

    func addItem(_ title: String, _ category: String) async {
        guard let id = flatId else { return }
        struct Row: Encodable { let flat_id, title, category: String; let added_by: String? }
        await run(nil) { try await self.client.from("flat_items").insert(Row(flat_id: id, title: title, category: category, added_by: self.uid)).execute() }
    }

    func setBought(_ item: ListItem, _ bought: Bool) async {
        // explicit nulls when un-ticking, so the old buyer is cleared
        struct Change: Encodable {
            let bought: Bool, bought_by: String?, bought_at: String?
            enum CodingKeys: String, CodingKey { case bought, bought_by, bought_at }
            func encode(to e: Encoder) throws {
                var c = e.container(keyedBy: CodingKeys.self)
                try c.encode(bought, forKey: .bought); try c.encode(bought_by, forKey: .bought_by); try c.encode(bought_at, forKey: .bought_at)
            }
        }
        Haptic.tap()
        let change = bought ? Change(bought: true, bought_by: uid, bought_at: ISO8601DateFormatter().string(from: Date())) : Change(bought: false, bought_by: nil, bought_at: nil)
        await run(nil) { try await self.client.from("flat_items").update(change).eq("id", value: item.id).execute() }
    }

    func deleteItem(_ id: String) async {
        await run(nil) { try await self.client.from("flat_items").delete().eq("id", value: id).execute() }
    }

    func clearBought() async {
        guard let id = flatId else { return }
        await run("Bought items cleared") { try await self.client.from("flat_items").delete().eq("flat_id", value: id).eq("bought", value: true).execute() }
    }

    /// turn what was bought into one shared bill
    func expenseFromBought() {
        let bought = items.filter(\.bought)
        guard !bought.isEmpty else { return }
        let top = Dictionary(grouping: bought, by: \.category).max { $0.value.count < $1.value.count }?.key ?? "groceries"
        startAddExpense(prefill: ExpensePrefill(desc: bought.map(\.title).joined(separator: ", "), category: top))
    }

    func addCategory(label: String, icon: String, color: String) async {
        guard let id = flatId else { return }
        struct Row: Encodable { let flat_id, key, label, icon, color: String; let created_by: String? }
        await run("“\(label)” added") {
            try await self.client.from("flat_categories").insert(Row(flat_id: id, key: Cats.slug(label), label: label, icon: icon, color: color, created_by: self.uid)).execute()
        }
    }

    func deleteCategory(_ c: FlatCategory) async {
        await run("Category deleted — its expenses now show as Other") {
            try await self.client.from("flat_categories").delete().eq("id", value: c.id).execute()
        }
    }

    /// one write: run it, reload, report
    private func run(_ success: String?, _ op: @escaping () async throws -> Void) async {
        do {
            try await op()
            if let success { Haptic.success(); show(success) }
            await loadFlat()
        } catch {
            show("Couldn't save — \(error.localizedDescription)")
        }
    }

    // MARK: personal data

    func saveProfile(_ p: Profile) {
        let renamed = !p.name.isEmpty && p.name != profile.name
        profile = p
        guard renamed else { return }
        Task {
            await touchAppUser()
            // needs supabase/migrations/20260911120000_member_display_name.sql; until then it updates nothing
            guard let uid else { return }
            struct Row: Encodable { let display_name: String }
            _ = try? await client.from("flat_members").update(Row(display_name: p.name)).eq("user_id", value: uid).execute()
            await loadFlat()
        }
    }


    func saveShift(_ s: Shift) {
        if let i = shifts.firstIndex(where: { $0.id == s.id }) { shifts[i] = s } else { shifts.insert(s, at: 0) }
        Haptic.success()
    }

    /// Replace the personal half with a restored backup, in one pass so the
    /// widgets and any observers see a single consistent change.
    func applyBackup(profile: Profile, shifts: [Shift], prefs: Prefs) {
        self.profile = profile
        self.shifts = shifts
        self.prefs = prefs
        publishWidgetData()
        show("Restored from iCloud")
    }

    /// Hand the widgets a fresh summary. They cannot reach the network or our
    /// session, so everything they draw has to be put in the shared container
    /// for them — cheap enough to do on every change.
    func publishWidgetData() {
        var d = WidgetData()
        d.inFlat = flat != nil
        d.flatName = flat?.name ?? ""
        d.net = myNet
        d.currency = hostCur
        let w = work
        d.daysUsed = w.daysUsed
        d.dayBudget = w.budget
        d.weekHours = w.weekH
        d.weekCap = w.weekCap
        d.recent = expenses.prefix(3).map {
            WidgetData.Item(id: $0.id,
                            title: ($0.description ?? "").isEmpty ? Cats.of(cats, $0.category).label : $0.description!,
                            subtitle: "\(nameOf($0.paidBy)) paid",
                            amount: $0.amount)
        }
        d.updated = Date()
        guard d != WidgetData.read() else { return }
        WidgetData.write(d)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// An intent may have written shifts while the app was in the background.
    /// `shifts` writes the whole array on every change, so without re-reading
    /// here the next edit in the app would silently overwrite that work.
    func reloadLocal() {
        if let onDisk: [Shift] = Self.load("shifts"), onDisk != shifts { shifts = onDisk }
        if let p: Profile = Self.load("profile"), p != profile { profile = p }
    }

    func deleteShift(_ id: String) {
        shifts.removeAll { $0.id == id }
        show("Shift deleted")
    }

    func clearLocal() {
        shifts = []
        show("Shifts cleared on this phone")
    }

    func refreshRate() async -> Double? {
        guard let r = await Rates.fetch(host: hostCur, home: homeCur) else { return nil }
        profile.rate = r
        profile.rateAt = Fmt.today()
        return r
    }

    func exportJSON() -> URL? {
        struct Export: Encodable { let app = "Heimat"; let exportedAt: String; let profile: Profile; let shifts: [Shift]; let settings: Prefs }
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(Export(exportedAt: ISO8601DateFormatter().string(from: Date()), profile: profile, shifts: shifts, settings: prefs)) else { return nil }
        return write(data, "heimat-\(Fmt.today()).json")
    }

    func exportCSV() -> URL? {
        let cell: (String) -> String = { $0.contains(where: { ",\"\n".contains($0) }) ? "\"\($0.replacingOccurrences(of: "\"", with: "\"\""))\"" : $0 }
        var rows = ["Date,Employer,Start,End,Break (min),Paid break,Paid hours,Hourly wage,Gross pay"]
        for s in shifts.sorted(by: { $0.date < $1.date }) {
            let c = Calc.shift(s)
            rows.append([s.date, s.employer, s.start, s.end, String(Int(s.breakMin)), s.paidBreak ? "yes" : "no",
                         String(format: "%.2f", c.paidHours), String(format: "%.2f", s.wage), String(format: "%.2f", c.pay)].map(cell).joined(separator: ","))
        }
        return write(Data(rows.joined(separator: "\n").utf8), "heimat-shifts-\(Fmt.today()).csv")
    }

    private func write(_ data: Data, _ name: String) -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        return (try? data.write(to: url)) != nil ? url : nil
    }

    // MARK: account

    func signUp(name: String, email: String, password: String) async -> String? {
        do {
            let user = try await client.auth.update(user: UserAttributes(email: email, password: password), redirectTo: URL(string: Secrets.publicURL))
            apply(user)
            if !name.isEmpty && name != profile.name { var p = profile; p.name = name; saveProfile(p) } else { await touchAppUser() }
            await claimWaitingInvites()
            await loadMyFlats()
            Haptic.success()
            // with email confirmation on, the address only attaches once the link is opened
            show(user.email != nil ? "Account created — sign in on any device" : "Almost there — confirm \(email) from the email we sent")
            return nil
        } catch {
            return friendly(error, "Couldn't create the account right now. Please try again in a minute.")
        }
    }

    func signIn(email: String, password: String) async -> String? {
        do {
            let s = try await client.auth.signIn(email: email, password: password)
            // the throwaway guest session's flat no longer applies
            flatId = nil
            clearFlat()
            apply(s.user)
            await touchAppUser()
            accountName = await appUserName()
            await claimWaitingInvites()
            await loadMyFlats()
            Haptic.success()
            show("Signed in")
            return nil
        } catch {
            return friendly(error, "Couldn't sign in right now. Please try again in a minute.")
        }
    }

    /// The emailed link opens Heimat's reset page on the web (reset.html), which says
    /// plainly that it is Heimat's — MoneyTrack shares this Supabase project.
    func sendReset(_ email: String) async -> String? {
        do {
            try await client.auth.resetPasswordForEmail(email, redirectTo: URL(string: Secrets.publicURL + "reset.html"))
            return nil
        } catch {
            return friendly(error, "Couldn't send the reset email right now. Please try again in a few minutes.")
        }
    }

    func setPassword(_ pw: String) async -> String? {
        do {
            apply(try await client.auth.update(user: UserAttributes(password: pw)))
            Haptic.success()
            show("Password updated")
            return nil
        } catch {
            return friendly(error, "Couldn't update the password right now. Please try again.")
        }
    }

    func changeEmail(_ newEmail: String) async -> String? {
        do {
            let u = try await client.auth.update(user: UserAttributes(email: newEmail), redirectTo: URL(string: Secrets.publicURL))
            apply(u)
            if u.email?.lowercased() != newEmail.lowercased() { pendingEmail = u.newEmail ?? newEmail }
            return nil
        } catch {
            return friendly(error, "Couldn't change the email right now. Please try again in a minute.")
        }
    }

    func signOut() async {
        try? await client.auth.signOut()
        flatId = nil
        flats = []
        clearFlat()
        accountName = nil
        if let s = try? await client.auth.signInAnonymously() { apply(s.user) }
        show("Signed out")
    }

    /// App Store 5.1.1(v): an app that can create an account must be able to delete one.
    func deleteAccount() async -> String? {
        do {
            try await client.functions.invoke("delete-account")
        } catch {
            return "Couldn't delete the account — try again"
        }
        try? await client.auth.signOut()
        for k in ["profile", "shifts", "flatId"] { UserDefaults.standard.removeObject(forKey: k) }
        flatId = nil; flats = []; clearFlat()
        shifts = []; profile = Profile()
        if let s = try? await client.auth.signInAnonymously() { apply(s.user) }
        return nil
    }

    // MARK: app_users — which accounts are Heimat's (MoneyTrack shares the auth table)

    private func touchAppUser() async {
        guard let uid, email != nil else { return }
        struct Row: Encodable { let user_id: String; let app = "heimat"; let display_name: String?; let last_seen_at: String }
        _ = try? await client.from("app_users")
            .upsert(Row(user_id: uid, display_name: profile.name.isEmpty ? nil : profile.name, last_seen_at: ISO8601DateFormatter().string(from: Date())), onConflict: "user_id,app")
            .execute()
    }

    private func appUserName() async -> String? {
        guard let uid else { return nil }
        struct Row: Decodable { let display_name: String? }
        let rows: [Row]? = try? await client.from("app_users").select("display_name").eq("user_id", value: uid).eq("app", value: "heimat").limit(1).execute().value
        return rows?.first?.display_name
    }

    /// the handful of auth errors people actually hit, in words that say what to do next
    /// The database raises these on purpose and writes them for a person to
    /// read — "Settle up with them first", "You already reminded them today".
    /// Passing them through beats replacing them with something vaguer.
    private func raised(_ error: Error) -> String? {
        guard let e = error as? PostgrestError else { return nil }
        let m = e.message.trimmingCharacters(in: .whitespacesAndNewlines)
        // anything that reads like plumbing rather than a sentence stays hidden
        guard !m.isEmpty, m.first?.isUppercase == true, !m.lowercased().contains("function"),
              !m.contains("relation"), !m.contains("permission denied") else { return nil }
        return m
    }

    private func friendly(_ error: Error, _ fallback: String) -> String {
        let m = String(describing: error).lowercased() + " " + error.localizedDescription.lowercased()
        if m.contains("invalid login") || m.contains("invalid_credentials") { return "That email and password don't match. Check for typos, or reset your password." }
        if m.contains("already") && (m.contains("registered") || m.contains("exists")) { return "An account with this email already exists — sign in instead." }
        if m.contains("not confirmed") { return "Confirm your email first — open the link we sent you, then sign in." }
        if m.contains("same_password") || m.contains("different from the old") { return "That is your current password — choose a new one." }
        if m.contains("weak") || m.contains("password should") { return "Choose a stronger password — at least 8 characters, ideally with a number or symbol." }
        if m.contains("rate limit") || m.contains("too many") { return "Too many attempts — wait a minute, then try again." }
        if m.contains("offline") || m.contains("network") || m.contains("internet") { return "Can't reach the server — check your connection and try again." }
        if m.contains("email") && m.contains("invalid") { return "That email address doesn't look right." }
        return fallback
    }

    // MARK: storage

    private func save<T: Encodable>(_ v: T, _ key: String) {
        UserDefaults.standard.set(try? JSONEncoder().encode(v), forKey: key)
    }
    private static func load<T: Decodable>(_ key: String) -> T? {
        UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }
}
