import Foundation
import Supabase

/// Friends: money with people outside any group, and with one person across
/// everything you share. Expenses outside a group live in hidden circles (a
/// `flats` row of kind "direct" whose members are exactly the people on it),
/// so all of this is read from the same per-place books as the groups — see
/// docs/friends-screens.md and the "Friends" section of docs/money-engine.md.
extension AppModel {

    /// What one person and you owe each other in one place, in one currency, in
    /// minor units; positive: they owe you.
    struct PlaceLine: Identifiable, Hashable {
        let place: String
        let currency: String
        let minor: Int
        var id: String { place + "\u{0}" + currency }
    }

    /// One person on the Non-group page: their money with you outside any group.
    struct FriendLine: Identifiable {
        let userId: String
        let name: String
        let pending: Bool
        /// per currency, the main one first; positive: they owe you
        let amounts: [(currency: String, minor: Int)]
        var id: String { userId }
        var square: Bool { amounts.allSatisfy { $0.minor == 0 } }
    }

    /// Someone you can pick for an expense: anyone you share a group or a circle with.
    struct Known: Identifiable, Hashable {
        let userId: String
        let name: String
        /// set while they are still invited, not on Heimat yet
        let email: String?
        let pending: Bool
        var id: String { userId }
    }

    // MARK: reading

    func isCircle(_ id: String) -> Bool { circles.contains { $0.id == id } }

    /// a group's name, or "Non-group expenses" for a circle
    func placeName(_ id: String) -> String { isCircle(id) ? "Non-group expenses" : flatName(id) }

    /// The name someone goes by: their own, from a group they joined, before an invitee's.
    func personName(_ u: String) -> String {
        let rows = allMembers.filter { $0.userId == u }
        return (rows.first { $0.claimedAt != nil } ?? rows.first)?.displayName ?? "Someone"
    }

    /// Everyone you could split with, by name. An invite that was declined or
    /// withdrawn is nobody; someone who left a group is still someone you know.
    var knownPeople: [Known] {
        var seen: [String: Known] = [:]
        for mem in allMembers where mem.userId != uid {
            let dead = mem.claimedAt == nil && (mem.hasLeft || mem.inviteToken == nil && mem.inviteEmail == nil)
            if dead { continue }
            let k = Known(userId: mem.userId, name: personName(mem.userId),
                          email: mem.claimedAt == nil ? mem.inviteEmail : nil, pending: mem.claimedAt == nil)
            if seen[mem.userId] == nil || (seen[mem.userId]!.pending && !k.pending) { seen[mem.userId] = k }
        }
        return seen.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Your money with `person`, place by place and currency by currency.
    func lines(with person: String, in places: [String]? = nil) -> [PlaceLine] {
        guard let uid else { return [] }
        var out: [PlaceLine] = []
        for id in (places ?? Array(placeBooks.keys)).sorted() {
            guard let book = placeBooks[id] else { continue }
            for b in book.books {
                let v = Ledger.pairwise(b.owes, for: uid)[person] ?? 0
                if v != 0 { out.append(PlaceLine(place: id, currency: b.currency, minor: v)) }
            }
        }
        return out
    }

    /// Lines added up per currency, the overview's currency first, then the largest.
    func totals(_ lines: [PlaceLine]) -> [(currency: String, minor: Int)] {
        var by: [String: Int] = [:]
        for l in lines { by[l.currency, default: 0] += l.minor }
        return by.filter { $0.value != 0 }
            .sorted { a, b in
                if (a.key == overviewCurrency) != (b.key == overviewCurrency) { return a.key == overviewCurrency }
                return abs(a.value) != abs(b.value) ? abs(a.value) > abs(b.value) : Ledger.less(a.key, b.key)
            }
            .map { (currency: $0.key, minor: $0.value) }
    }

    /// Everyone you have a non-group expense with — money outside every group only,
    /// so nothing a group already shows is counted twice. Most owed first; the
    /// settled ones last.
    var friendLines: [FriendLine] {
        let ids = circles.map(\.id)
        let people = Set(allMembers.filter { ids.contains($0.flatId) && $0.userId != uid }.map(\.userId))
        return people.map { u in
            let pending = !allMembers.contains { $0.userId == u && $0.claimedAt != nil }
            return FriendLine(userId: u, name: personName(u), pending: pending, amounts: totals(lines(with: u, in: ids)))
        }
        .sorted { a, b in
            let x = abs(a.amounts.first?.minor ?? 0), y = abs(b.amounts.first?.minor ?? 0)
            return x != y ? x > y : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    /// your money outside every group, per currency
    var nonGroupTotals: [(currency: String, minor: Int)] {
        let ids = circles.map(\.id)
        return totals(friendLines.flatMap { f in lines(with: f.userId, in: ids) })
    }

    /// your balance in one group or circle, in its own main currency
    func myBalance(in place: String) -> (minor: Int, currency: String) {
        guard let uid, let book = placeBooks[place] else { return (0, hostCur) }
        return (book.netMinor[uid] ?? 0, book.currency)
    }

    /// The circle that is just you and `person`, if you have one.
    func pairCircle(with person: String) -> String? {
        guard let uid else { return nil }
        let want: Set<String> = [uid, person]
        return circles.first { c in
            let rows = allMembers.filter { $0.flatId == c.id }
            return Set(rows.map(\.userId)) == want && !rows.contains(where: \.hasLeft)
        }?.id
    }

    /// Expenses both of you are on, anywhere, newest first.
    func sharedExpenses(with person: String) -> [Expense] {
        guard let uid else { return [] }
        return allExpenses.filter { e in
            let p = Ledger.postings(e)
            let on = Set(e.parts).union(p?.paid.keys.map { $0 } ?? []).union([e.paidBy])
            return on.contains(uid) && on.contains(person)
        }
    }

    // MARK: writing

    /// Whether an address is on Heimat, and the name they use (the owner chose to show it, as Splitwise does).
    func findPerson(_ email: String) async -> (onHeimat: Bool, name: String?)? {
        struct Row: Decodable { let on_heimat: Bool; let name: String? }
        #if DEBUG
        if Self.fixtureMode { return email.hasPrefix("tom") ? (true, "Tom") : (false, nil) }
        #endif
        do {
            let rows: [Row] = try await client.rpc("find_person", params: ["p_email": email.trimmingCharacters(in: .whitespaces)]).execute().value
            return rows.first.map { ($0.on_heimat, $0.name) }
        } catch {
            show(friendsMessage(error, "Couldn't look that address up right now."))
            return nil
        }
    }

    /// The circle for you and these people, found or made, with its people loaded.
    func friendCircle(_ picks: [PersonPick]) async -> String? {
        struct P: Encodable { let p_people: [[String: String]] }
        #if DEBUG
        if Self.fixtureMode { return fixtureCircle(picks) }
        #endif
        do {
            let f: Flat = try await client.rpc("friend_circle", params: P(p_people: picks.map(\.json))).execute().value
            if !circles.contains(where: { $0.id == f.id }) { circles.append(f) }
            await loadOverview()
            return f.id
        } catch {
            show(friendsMessage(error, "Couldn't add them right now — try again."))
            return nil
        }
    }

    /// Adds or edits an expense outside any group: the server finds or makes the
    /// circle for you and `people`, and moves the expense there when its people change.
    func saveFriendExpense(_ id: String, people: [String], _ d: ExpenseDraft, editing: Bool) async -> Bool {
        struct X: Encodable {
            let description: String, amount: Double, currency: String, paid_by: String, split_among: [String]
            let split_type: String, split: SplitData?, payers: [String: Int]?, category: String, spent_on: String
        }
        struct P: Encodable { let p_id: String; let p_people: [[String: String]]; let p_expense: X }
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return false }
        #endif
        let x = X(description: d.desc, amount: d.amount, currency: d.currency ?? hostCur, paid_by: d.paidBy, split_among: d.among,
                  split_type: d.splitType, split: d.split, payers: d.payers, category: d.category, spent_on: d.spentOn)
        do {
            _ = try await client.rpc("save_friend_expense", params: P(p_id: id, p_people: people.map { ["user_id": $0] }, p_expense: x)).execute()
            Haptic.success()
            show(editing ? "Expense updated" : "Expense added")
            await loadMyFlats()
            return true
        } catch {
            show(friendsMessage(error, "Couldn't save — try again."))
            return false
        }
    }

    /// One payment with `person`, spread over every place you owe each other in
    /// (Ledger.spread), written in one request: all of it lands, or none.
    /// `iPay`: you paid them; otherwise they paid you.
    func settle(with person: String, currency: String, pay: Int, iPay: Bool) async {
        guard let uid, pay > 0 else { return }
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return }
        #endif
        // what the payer owes the payee, place by place
        let places = lines(with: person).filter { $0.currency == currency }
            .map { Ledger.SpreadPlace(place: $0.place, owed: iPay ? -$0.minor : $0.minor) }
        let pending = "\u{0}pair"
        var parts = Ledger.spread(pay, places, fallback: pairCircle(with: person) ?? pending)
        if parts.contains(where: { $0.place == pending }) {
            guard let pair = await friendCircle([PersonPick(userId: person, name: personName(person))]) else { return }
            parts = parts.map { $0.place == pending ? Ledger.SpreadPart(place: pair, minor: $0.minor, reverse: $0.reverse) : $0 }
        }
        let payer = iPay ? uid : person, payee = iPay ? person : uid
        struct Row: Encodable { let flat_id, from_user, to_user: String; let amount: Double; let currency: String; let created_by: String; let settled_on: String }
        let rows = parts.map { p in
            Row(flat_id: p.place, from_user: p.reverse ? payee : payer, to_user: p.reverse ? payer : payee,
                amount: Money.toMajor(p.minor, currency), currency: currency, created_by: uid, settled_on: Fmt.today())
        }
        do {
            try await client.from("settlements").insert(rows).execute()
            Haptic.success()
            show("Payment recorded")
            await loadFlat()
        } catch {
            show(friendsMessage(error, "Couldn't record that payment — try again."))
        }
    }

    /// A reminder to someone who owes you — sent from the place they owe you most,
    /// non-group expenses first. Once a day, over 0,50 € (the server's rules).
    func remind(_ person: String) async {
        let owed = lines(with: person).filter { $0.minor > 0 && $0.currency == (placeBooks[$0.place]?.currency ?? $0.currency) }
        guard let place = owed.sorted(by: { a, b in
            if isCircle(a.place) != isCircle(b.place) { return isCircle(a.place) }
            return a.minor != b.minor ? a.minor > b.minor : Ledger.less(a.place, b.place)
        }).first?.place else { show("They don't owe you anything right now"); return }
        struct P: Encodable { let p_flat: String, p_uid: String }
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is sent"); return }
        #endif
        do {
            _ = try await client.rpc("nudge", params: P(p_flat: place, p_uid: person)).execute()
            Haptic.success()
            show("Reminded \(personName(person))")
        } catch {
            show(raised(error) ?? friendly(error, "Couldn't send that reminder."))
        }
    }

    /// The server's own words for what went wrong, readable: "friends: …" and
    /// "split: …" refusals become a sentence; anything else falls back.
    func friendsMessage(_ error: Error, _ fallback: String) -> String {
        if let r = raised(error) { return r }
        guard let e = error as? PostgrestError else { return friendly(error, fallback) }
        let m = e.message
        if m.contains("not someone you know") { return "You can only pick people you share a group with — add anyone else by email." }
        if m.contains("isn't on the expense") { return "Everyone you picked has to be on the expense — remove them, or include them in the split." }
        if m.contains("not_in_flat") { return "Someone on this expense isn't one of the people you picked." }
        if m.hasPrefix("friends: ") {
            let rest = m.dropFirst("friends: ".count)
            return rest.prefix(1).uppercased() + rest.dropFirst()
        }
        return friendly(error, fallback)
    }

    /// Someone who deleted their account: turn their old place back into a personal
    /// link (invite_back), so whoever opens it takes over their history.
    func inviteBack(_ mem: Member) async -> URL? {
        struct P: Encodable { let p_member: String }
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is sent"); return nil }
        #endif
        do {
            let token: String = try await client.rpc("invite_back", params: P(p_member: mem.id)).execute().value
            Haptic.success()
            await loadFlat()
            return URL(string: "\(Secrets.publicURL)invite.html?t=\(token)")
        } catch {
            let text = String(describing: error)
            if let r = text.range(of: "invite_back: ") {
                let msg = text[r.upperBound...].prefix { $0 != "\"" && $0 != "\n" }
                show(msg.prefix(1).uppercased() + msg.dropFirst())
            } else { show("Couldn't invite them back right now — try again.") }
            return nil
        }
    }
}
