import Foundation

/// What Siri says, worked out from plain rows — no network, no views — so it is
/// tested with plain swiftc (tests/siri-vectors.json). Money comes in whole minor
/// units; `money` and `day` turn them into words the way the app shows them.
enum SiriAnswers {
    /// what you and one person owe each other in one place (positive: they owe you),
    /// as `my_pairwise()` returns it — the plan's payment in a simplified group
    struct Line: Equatable {
        var place: String
        /// the group's name; empty outside any group
        var placeName: String
        var person: String
        var personName: String
        var currency: String
        var minor: Int
    }

    /// "How much do I owe Kevin?" — or, with no one named, everyone you're not square with.
    static func balance(_ lines: [Line], person: String?, personName: String? = nil,
                        money: (Int, String) -> String) -> String {
        if let person {
            let mine = lines.filter { $0.person == person && $0.minor != 0 }
            let name = mine.first?.personName ?? personName ?? "They"
            let byCurrency = sums(mine)
            guard !byCurrency.isEmpty else { return "You and \(name) are settled up." }
            var parts = byCurrency.map { c, minor in
                minor > 0 ? "\(name) owes you \(money(minor, c))" : "You owe \(name) \(money(-minor, c))"
            }
            // more than one place: say where it comes from
            let places = mine.map(\.place).uniqued()
            if places.count > 1 {
                let detail = places.compactMap { p -> String? in
                    let here = mine.filter { $0.place == p }
                    guard let first = here.first else { return nil }
                    let total = here.reduce(0) { $0 + $1.minor }
                    guard total != 0 else { return nil }
                    let where_ = first.placeName.isEmpty ? "outside groups" : "in \(first.placeName)"
                    return "\(money(abs(total), first.currency)) \(where_)\(total < 0 ? " (you owe)" : "")"
                }
                if !detail.isEmpty { parts[parts.count - 1] += " — " + detail.joined(separator: ", ") }
            }
            return parts.joined(separator: ". ") + "."
        }
        // everyone: who owes you, then whom you owe, biggest first
        var people: [(name: String, currency: String, minor: Int)] = []
        for p in lines.map(\.person).uniqued() {
            let mine = lines.filter { $0.person == p }
            for (c, minor) in sums(mine) where minor != 0 { people.append((mine[0].personName, c, minor)) }
        }
        guard !people.isEmpty else { return "You're settled up with everyone." }
        /// "Nina owes you 20,66 €, Ben 12,67 €, Dana 6,67 € and 2 others 7,34 € between them":
        /// the verb once, the three biggest by name, the rest together
        func list(_ xs: [(name: String, currency: String, minor: Int)], _ first: (String, String) -> String) -> String {
            let top = xs.sorted { abs($0.minor) != abs($1.minor) ? abs($0.minor) > abs($1.minor) : $0.name < $1.name }
            let named = top.count <= 4 ? top : Array(top.prefix(3))
            var parts = named.enumerated().map { i, x in
                i == 0 ? first(x.name, money(abs(x.minor), x.currency)) : "\(x.name) \(money(abs(x.minor), x.currency))"
            }
            let rest = top.dropFirst(named.count)
            if !rest.isEmpty {
                let currencies = Set(rest.map(\.currency))
                let sum = rest.reduce(0) { $0 + abs($1.minor) }
                parts.append(currencies.count == 1 ? "\(rest.count) others \(money(sum, rest.first!.currency)) between them" : "\(rest.count) others")
            }
            return joined(parts)
        }
        var out: [String] = []
        let owed = people.filter { $0.minor > 0 }, owe = people.filter { $0.minor < 0 }
        if !owed.isEmpty { out.append(list(owed) { "\($0) owes you \($1)" }) }
        if !owe.isEmpty { out.append(list(owe) { "you owe \($0) \($1)" }) }
        // each sentence starts with a capital
        return out.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: ". ") + "."
    }

    /// a chore's current turn, as the app keeps it
    struct Turn: Equatable {
        var chore: String
        var choreName: String
        var n: Int
        var assignee: String?
        var assigneeName: String?
        /// open · done · missed
        var state: String
        /// yyyy-MM-dd
        var startsOn: String
        var endsOn: String
    }

    /// "Whose turn is it for the bathroom?" — or, with no chore named, yours.
    static func turn(_ turns: [Turn], chore: String?, me: String?, today: String, day: (String) -> String) -> String {
        if let chore {
            let mine = turns.filter { $0.chore == chore }.sorted { $0.n < $1.n }
            guard let now = mine.first else { return "That chore has no one on its rota yet." }
            let next = mine.dropFirst().first
            func who(_ t: Turn) -> String { t.assignee == nil ? "no one's" : t.assignee == me ? "your" : "\(t.assigneeName ?? "someone")'s" }
            if now.state == "done" {
                let after = next.map { " Next it's \(who($0)) turn, from \(day($0.startsOn))." } ?? ""
                return "\(now.choreName) is done for this time.\(after)"
            }
            if now.startsOn > today { return "It's \(who(now)) turn for \(now.choreName), from \(day(now.startsOn))." }
            return "It's \(who(now)) turn for \(now.choreName), until \(day(now.endsOn))."
        }
        // yours: open turns that have started, soonest due first
        let current = Dictionary(grouping: turns, by: \.chore).compactMap { $0.value.min { $0.n < $1.n } }
        let yours = current.filter { $0.assignee == me && $0.state == "open" && $0.startsOn <= today }.sorted { $0.endsOn < $1.endsOn }
        if yours.isEmpty {
            let soon = turns.filter { $0.assignee == me && $0.state == "open" && $0.startsOn > today }.min { $0.startsOn < $1.startsOn }
            return "None of the chores are yours right now." + (soon.map { " Next: \($0.choreName), from \(day($0.startsOn))." } ?? "")
        }
        return "Your turn: " + joined(yours.map { "\($0.choreName), until \(day($0.endsOn))" }) + "."
    }

    /// a bill and where it stands, as `my_bills()` says
    struct BillDue: Equatable {
        var name: String
        var minor: Int?
        var currency: String
        var dueOn: String
        /// upcoming · due · overdue · paid
        var state: String
    }

    /// "What bills are due?" — overdue first, then due, then the next one coming.
    static func bills(_ bills: [BillDue], money: (Int, String) -> String, day: (String) -> String) -> String {
        func say(_ b: BillDue) -> String { b.name + (b.minor.map { " (\(money($0, b.currency)))" } ?? "") }
        let overdue = bills.filter { $0.state == "overdue" }.sorted { $0.dueOn < $1.dueOn }
        let due = bills.filter { $0.state == "due" }.sorted { $0.dueOn < $1.dueOn }
        var out: [String] = []
        if !overdue.isEmpty { out.append("Overdue: " + joined(overdue.map { "\(say($0)) since \(day($0.dueOn))" })) }
        if !due.isEmpty { out.append("Due: " + joined(due.map { "\(say($0)) \(when(day($0.dueOn)))" })) }
        if out.isEmpty {
            guard let next = bills.filter({ $0.state == "upcoming" }).min(by: { $0.dueOn < $1.dueOn }) else { return "You have no bills to pay." }
            return "Nothing is due. Next: \(say(next)) on \(day(next.dueOn))."
        }
        return out.joined(separator: ". ") + "."
    }

    /// a day as said after a name: "today", "tomorrow", "on Sunday", "on Oct 1"
    static func when(_ day: String) -> String {
        ["Today", "Tomorrow", "Yesterday"].contains(day) ? day.lowercased() : "on \(day)"
    }

    /// per currency, the biggest first
    private static func sums(_ lines: [Line]) -> [(String, Int)] {
        var by: [String: Int] = [:]
        for l in lines { by[l.currency, default: 0] += l.minor }
        return by.filter { $0.value != 0 }.sorted { abs($0.value) != abs($1.value) ? abs($0.value) > abs($1.value) : $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    /// "a", "a and b", "a, b and c"
    static func joined(_ xs: [String]) -> String {
        xs.count <= 2 ? xs.joined(separator: " and ") : xs.dropLast().joined(separator: ", ") + " and " + xs.last!
    }
}

extension Array where Element: Hashable {
    /// in order, each once
    func uniqued() -> [Element] { var seen = Set<Element>(); return filter { seen.insert($0).inserted } }
}
