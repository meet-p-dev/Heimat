import Foundation

/// Bills (docs/bills-screens.md): loading them with where each stands, saving,
/// ticking. The database works out due dates and states (my_bills), so the app
/// and the reminders always agree.
extension AppModel {
    func loadBills() async {
        #if DEBUG
        if Self.fixtureMode { return }
        #endif
        guard uid != nil else { bills = []; billStatus = [:]; return }
        do {
            async let b: [Bill] = client.from("bills").select().is("archived_at", value: nil).order("created_at").execute().value
            async let s: [BillStatus] = client.rpc("my_bills").execute().value
            let (all, states) = try await (b, s)
            bills = all
            billStatus = Dictionary(states.map { ($0.billId, $0) }, uniquingKeysWith: { a, _ in a })
        } catch {
            // the tables arrive with the migration; until then there are simply no bills
        }
    }

    func bills(in flatId: String?) -> [Bill] {
        bills.filter { $0.flatId == flatId && (flatId != nil || $0.ownerId == uid) }
            .sorted { (billStatus[$0.id]?.dueOn ?? $0.anchorOn, $0.name) < (billStatus[$1.id]?.dueOn ?? $1.anchorOn, $1.name) }
    }

    /// the one a card should mention: overdue first, then due, then the next coming up
    func nextBill(in flatId: String?) -> (bill: Bill, status: BillStatus)? {
        let rank = ["overdue": 0, "due": 1, "upcoming": 2, "paid": 3]
        return bills(in: flatId).compactMap { b in billStatus[b.id].map { (b, $0) } }
            .min { (rank[$0.1.state] ?? 9, $0.1.dueOn) < (rank[$1.1.state] ?? 9, $1.1.dueOn) }
    }

    struct BillRow: Encodable {
        let flat_id: String?, owner_id: String?, name: String, amount: Double?, currency: String, category: String
        let cadence: String, anchor_on: String, payer: String?
        let contract_ends_on: String?, notice_amount: Int?, notice_unit: String?
    }

    func saveBill(id: String?, _ row: BillRow) async -> Bool {
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return true }
        #endif
        do {
            if let id {
                try await client.from("bills").update(row).eq("id", value: id).execute()
            } else {
                try await client.from("bills").insert(row).execute()
            }
            Haptic.success()
            await loadBills()
            return true
        } catch {
            show(billMessage(error))
            return false
        }
    }

    func deleteBill(_ b: Bill) async {
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return }
        #endif
        struct Row: Encodable { let archived_at: String }
        do {
            try await client.from("bills").update(Row(archived_at: ISO8601DateFormatter().string(from: Date()))).eq("id", value: b.id).execute()
            bills.removeAll { $0.id == b.id }
            show("\(b.name) removed")
        } catch { show(billMessage(error)) }
    }

    /// tick a due date as paid (or take the tick back)
    func tickBill(_ b: Bill, due: String, paid: Bool) async {
        struct P: Encodable { let p_bill: String, p_due: String, p_paid: Bool }
        #if DEBUG
        if Self.fixtureMode { show("Demo mode — nothing is saved"); return }
        #endif
        do {
            _ = try await client.rpc("tick_bill", params: P(p_bill: b.id, p_due: due, p_paid: paid)).execute()
            if paid { Haptic.success() }
            await loadBills()
        } catch { show(billMessage(error)) }
    }

    private func billMessage(_ error: Error) -> String {
        let text = String(describing: error)
        if let r = text.range(of: "bills: ") {
            let rest = text[r.upperBound...]
            let msg = rest.prefix { $0 != "\"" && $0 != "\n" && $0 != "," }
            return msg.prefix(1).uppercased() + msg.dropFirst()
        }
        return "Couldn't save that right now — try again."
    }

    /// "Due today", "Overdue since 1 Oct", "Due in 3 days", "Paid ✓ by Nina"
    func billLine(_ b: Bill, _ s: BillStatus?) -> (text: String, urgent: Bool) {
        guard let s else { return ("Due \(Fmt.relDay(b.anchorOn))", false) }
        switch s.state {
        case "due": return ("Due today", true)
        case "overdue": return ("Overdue since \(Fmt.relDay(s.dueOn))", true)
        case "paid":
            let who = s.paidBy.map { $0 == uid ? "you" : personName($0) } ?? "someone"
            return ("Paid ✓ by \(who) · next \(Fmt.relDay(s.dueOn))", false)
        default:
            let days = Calendar(identifier: .gregorian).dateComponents([.day], from: Fmt.date(Fmt.today()) ?? Date(), to: Fmt.date(s.dueOn) ?? Date()).day ?? 0
            return (days == 1 ? "Due tomorrow" : days < 7 ? "Due in \(days) days" : "Due \(Fmt.relDay(s.dueOn))", false)
        }
    }
}
