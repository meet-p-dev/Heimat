import Foundation

/// The chores rota (docs/chores-screens.md). The database keeps the turns —
/// who has which period, skips and swaps, missed and done — so every phone and
/// the reminders agree; the app asks (my_chores) and acts through its functions.
extension AppModel {
    func loadChores() async {
        #if DEBUG
        if Self.fixtureMode { return }
        #endif
        guard uid != nil, !flats.isEmpty else { chores = []; choreTurns = []; choreSwaps = []; choresDone = []; return }
        let month = String(Fmt.today().prefix(7)) + "-01"
        do {
            async let c: [Chore] = client.from("chores").select().is("archived_at", value: nil).order("created_at").execute().value
            async let t: [ChoreTurn] = client.rpc("my_chores").execute().value
            async let s: [ChoreSwap] = client.from("chore_swaps").select().is("answer", value: nil).execute().value
            async let d: [ChoreTurn] = client.from("chore_turns").select().eq("state", value: "done").gte("done_at", value: month).execute().value
            (chores, choreTurns, choreSwaps, choresDone) = try await (c, t, s, d)
        } catch {
            // the tables arrive with the migration; until then there are simply no chores
        }
    }

    func chores(in flatId: String) -> [Chore] { chores.filter { $0.flatId == flatId } }

    /// this period's turn (the earlier of the two the database keeps) and the next
    func turns(of c: Chore) -> (now: ChoreTurn?, next: ChoreTurn?) {
        let t = choreTurns.filter { $0.choreId == c.id }.sorted { $0.n < $1.n }
        return (t.first, t.dropFirst().first)
    }

    /// your open turns in a group that have started: "Your turn: Bathroom"
    func myTurns(in flatId: String) -> [Chore] {
        chores(in: flatId).filter { c in
            guard let t = turns(of: c).now else { return false }
            return t.assignee == uid && t.state == "open" && t.startsOn <= Fmt.today()
        }
    }

    /// points this month, per person, highest first
    func choreBoard(in flatId: String) -> [(user: String, points: Int, done: Int)] {
        var by: [String: (Int, Int)] = [:]
        for t in choresDone where t.flatId == flatId { if let u = t.doneBy { by[u, default: (0, 0)].0 += t.points ?? 0; by[u, default: (0, 0)].1 += 1 } }
        return by.map { ($0.key, $0.value.0, $0.value.1) }.sorted { $0.points != $1.points ? $0.points > $1.points : $0.user < $1.user }
    }

    struct ChoreRow: Encodable { let flat_id: String, name: String, cadence: String, anchor_on: String, points: Int, rota: [String] }

    func saveChore(id: String?, _ row: ChoreRow) async -> Bool {
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return true }
        #endif
        do {
            if let id { try await client.from("chores").update(row).eq("id", value: id).execute() }
            else { try await client.from("chores").insert(row).execute() }
            Haptic.success()
            await loadChores()
            return true
        } catch { show(choreMessage(error)); return false }
    }

    func deleteChore(_ c: Chore) async {
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return }
        #endif
        struct Row: Encodable { let archived_at: String }
        do {
            try await client.from("chores").update(Row(archived_at: ISO8601DateFormatter().string(from: Date()))).eq("id", value: c.id).execute()
            chores.removeAll { $0.id == c.id }
            show("\(c.name) removed")
        } catch { show(choreMessage(error)) }
    }

    func tickChore(_ t: ChoreTurn, done: Bool) async {
        struct P: Encodable { let p_chore: String, p_n: Int, p_done: Bool }
        await choreCall("chore_tick", P(p_chore: t.choreId, p_n: t.n, p_done: done), success: done)
    }

    func skipChore(_ t: ChoreTurn) async {
        struct P: Encodable { let p_chore: String, p_n: Int }
        if await choreCall("chore_skip", P(p_chore: t.choreId, p_n: t.n)) { show("Skipped — it comes back to you next time") }
    }

    func askSwap(_ t: ChoreTurn, to person: String) async {
        struct P: Encodable { let p_chore: String, p_n: Int, p_to: String }
        if await choreCall("chore_swap_ask", P(p_chore: t.choreId, p_n: t.n, p_to: person)) { show("Asked \(personName(person))") }
    }

    func answerSwap(_ s: ChoreSwap, accept: Bool) async {
        struct P: Encodable { let p_swap: String, p_accept: Bool }
        await choreCall("chore_swap_answer", P(p_swap: s.id, p_accept: accept), success: accept)
    }

    @discardableResult
    private func choreCall<P: Encodable & Sendable>(_ fn: String, _ p: P, success: Bool = false) async -> Bool {
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return false }
        #endif
        do {
            _ = try await client.rpc(fn, params: p).execute()
            if success { Haptic.success() }
            await loadChores()
            return true
        } catch { show(choreMessage(error)); await loadChores(); return false }
    }

    private func choreMessage(_ error: Error) -> String {
        let text = String(describing: error)
        if let r = text.range(of: "chores: ") {
            let msg = text[r.upperBound...].prefix { $0 != "\"" && $0 != "\n" && $0 != "," }
            return msg.prefix(1).uppercased() + msg.dropFirst()
        }
        return "Couldn't do that right now — try again."
    }
}
