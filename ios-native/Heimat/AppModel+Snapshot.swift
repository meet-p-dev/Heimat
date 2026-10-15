import Foundation

/// What the app showed last time, kept on this phone, so opening it shows your groups at once
/// instead of an empty Home (and "Get started") while the server is asked again. It is replaced
/// after every full load and deleted on sign-out. It never leaves the phone.
extension AppModel {
    struct Snapshot: Codable {
        var uid: String
        var flats: [Flat], circles: [Flat], flatId: String?
        var members: [Member], expenses: [Expense], settles: [Settlement]
        var allMembers: [Member], allExpenses: [Expense], allSettles: [Settlement]
        var bills: [Bill], billStatus: [String: BillStatus]
        var chores: [Chore], choreTurns: [ChoreTurn], choreSwaps: [ChoreSwap], choresDone: [ChoreTurn]
        var items: [ListItem], flatCats: [FlatCategory], allCats: [FlatCategory]
    }

    private static var snapshotURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("splitlife-snapshot.json")
    }

    /// the last copy for this account, shown straight away; false when there is none
    @discardableResult
    func restoreSnapshot(for uid: String) -> Bool {
        guard let data = try? Data(contentsOf: Self.snapshotURL),
              let s = try? JSONDecoder().decode(Snapshot.self, from: data), s.uid == uid else { return false }
        flats = s.flats; circles = s.circles
        if flatId == nil || !(s.flats.contains { $0.id == flatId }) { flatId = s.flatId }
        members = s.members; expenses = s.expenses; settles = s.settles
        allMembers = s.allMembers; allExpenses = s.allExpenses; allSettles = s.allSettles
        bills = s.bills; billStatus = s.billStatus
        chores = s.chores; choreTurns = s.choreTurns; choreSwaps = s.choreSwaps; choresDone = s.choresDone
        items = s.items; flatCats = s.flatCats; allCats = s.allCats
        placesLoaded = true
        return true
    }

    /// after a full load: what Home and the open group need next time
    func saveSnapshot() {
        #if DEBUG
        if Self.fixtureMode { return }
        #endif
        guard let uid else { return }
        let s = Snapshot(uid: uid, flats: flats, circles: circles, flatId: flatId, members: members, expenses: expenses, settles: settles,
                         allMembers: allMembers, allExpenses: allExpenses, allSettles: allSettles, bills: bills, billStatus: billStatus,
                         chores: chores, choreTurns: choreTurns, choreSwaps: choreSwaps, choresDone: choresDone,
                         items: items, flatCats: flatCats, allCats: allCats)
        let url = Self.snapshotURL
        Task.detached(priority: .utility) {
            if let data = try? JSONEncoder().encode(s) { try? data.write(to: url, options: [.atomic, .completeFileProtection]) }
        }
    }

    /// signed out or account deleted: nothing of theirs stays on the phone
    static func dropSnapshot() { try? FileManager.default.removeItem(at: snapshotURL) }
}
