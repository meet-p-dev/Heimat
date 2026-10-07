import SwiftUI

/// Everything that has happened in all your groups and non-group expenses, newest first:
/// expenses, payments, people, the shopping list, bills and chores. Opened from Home's
/// Activity; nothing here is ever pushed to anyone — you see it when you come and look.
/// The rows come from database triggers rather than the app, so an expense edited on the
/// web, added by Siri or deleted from a widget all show up the same way.
struct ActivityView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    /// one group, "non-group", or nil for everything
    @State private var place: String?
    @State private var loading = true

    private static let nonGroup = "non-group"

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if places.count > 1 { filter }
                if rows.isEmpty {
                    if !loading {
                        ContentUnavailableView("Nothing yet", systemImage: "clock",
                                               description: Text("Everything anyone adds, changes or ticks off in your groups shows up here."))
                            .padding(.top, 60)
                    }
                } else {
                    ForEach(days, id: \.key) { day in
                        SectionLabel(day.label)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.top, 18).padding(.bottom, 8)
                        HeimatCard(radius: 22, padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(day.list.enumerated()), id: \.element.id) { i, a in
                                    ActivityRowView(a: a, showsPlace: place == nil && places.count > 1, showsTime: true)
                                    if i < day.list.count - 1 { RowDivider(inset: 56) }
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .heimatScreen()
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .overlay { if loading && rows.isEmpty { ProgressView() } }
        .task { await m.loadActivity(); loading = false }
        .refreshable { await m.loadActivity() }
    }

    /// your groups by name, then non-group expenses if you have any
    private var places: [(id: String, name: String)] {
        m.flats.map { ($0.id, $0.name) } + (m.circles.isEmpty ? [] : [(Self.nonGroup, "Non-group")])
    }

    private var filter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(text: "All", on: place == nil) { place = nil }
                ForEach(places, id: \.id) { p in
                    Chip(text: p.name, on: place == p.id) { place = p.id }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 8)
    }

    private var rows: [Activity] {
        let all = m.visibleActivity
        switch place {
        case nil: return all
        case Self.nonGroup?: return all.filter { m.isCircle($0.flatId) }
        case let id?: return all.filter { $0.flatId == id }
        }
    }

    /// grouped by day, because "when" is the question being asked
    private var days: [(key: String, label: String, list: [Activity])] {
        var out: [(key: String, label: String, list: [Activity])] = []
        for a in rows {
            // the day it was here, not the day it was in UTC: slicing the
            // timestamp files anything after local midnight under yesterday
            let k = ISO8601DateFormatter.heimat.date(from: a.at).map(Fmt.ymd) ?? String(a.at.prefix(10))
            if out.last?.key != k { out.append((k, Fmt.relDay(k), [])) }
            out[out.count - 1].list.append(a)
        }
        return out
    }
}

/// One line of Activity: what happened, in a sentence, with the thing it happened to in
/// bold; the group it was in when the list mixes groups; when (the time on the Activity
/// page, the day on Home); and the amount, struck through when it was undone.
struct ActivityRowView: View {
    @Environment(AppModel.self) private var m
    let a: Activity
    var showsPlace = false
    /// the time of day (the Activity page, under a day heading) or the day (Home)
    var showsTime = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: a.symbol)
                .font(.system(size: 18))
                .foregroundStyle(a.isGone ? Color.secondary : a.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(sentence).font(.system(size: 14.5))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    Text(when)
                    if showsPlace {
                        Text("·")
                        Text(m.placeName(a.flatId)).lineLimit(1)
                    }
                }
                .font(.system(size: 12)).foregroundStyle(.tertiary)
            }
            Spacer(minLength: 8)
            if let amt = a.amount {
                Text(m.fH(amt))
                    .font(.system(size: 14.5, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(a.isGone ? Color.secondary : Color.primary)
                    .strikethrough(a.isGone, color: .secondary)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private func name(_ u: String?) -> String {
        guard let u else { return "Someone" }
        return m.nameOf(u, in: a.flatId)
    }

    private var sentence: AttributedString {
        let who = a.actor == nil ? "Splitlife" : name(a.actor)
        let what = a.subject ?? ""
        // mid-sentence, you are "you"
        let mid = { (u: String?) in u != nil && u == m.uid ? "you" : name(u) }
        let to = mid(a.meta["to"]), from = mid(a.meta["from"])
        let text: String
        switch a.kind {
        case "expense_added":    text = "\(who) added \(what.isEmpty ? "an expense" : what)"
        case "expense_edited":   text = "\(who) changed \(what.isEmpty ? "an expense" : what)"
        case "expense_deleted":  text = "\(who) deleted \(what.isEmpty ? "an expense" : what)"
        case "expense_restored": text = "\(who) brought back \(what.isEmpty ? "an expense" : what)"
        case "settled":          text = "\(who) settled up with \(what)"
        case "settle_undone":    text = "\(who) undid a payment to \(what)"
        case "joined":           text = "\(what) joined"
        case "invited":          text = "\(who) invited \(what)"
        case "left":             text = "\(what) left"
        case "invite_withdrawn": text = "\(who) withdrew the invite to \(what)"
        case "recurring_added":  text = "\(who) set \(what) to repeat"
        case "recurring_edited": text = "\(who) changed the repeating \(what)"
        case "recurring_deleted": text = "\(who) stopped repeating \(what)"
        case "recurring_paused": text = "Repeating \(what) was paused"
        case "recurring_stopped": text = "Repeating \(what) stopped"
        case "simplify_on":      text = "\(who) turned on simplified debts"
        case "simplify_off":     text = "\(who) turned off simplified debts"
        case "item_added":       text = "\(who) added \(what) to the list"
        case "item_bought":      text = "\(who) bought \(what)"
        case "item_removed":     text = "\(who) took \(what) off the list"
        case "bill_added":       text = "\(who) added the bill \(what)"
        case "bill_edited":      text = "\(who) changed the bill \(what)"
        case "bill_removed":     text = "\(who) removed the bill \(what)"
        case "bill_paid":        text = "\(who) marked \(what) as paid"
        case "bill_unpaid":      text = "\(who) marked \(what) as not paid"
        case "chore_added":      text = "\(who) added the chore \(what)"
        case "chore_edited":     text = "\(who) changed the chore \(what)"
        case "chore_removed":    text = "\(who) removed the chore \(what)"
        case "chore_done":       text = "\(who) did \(what)"
        case "chore_undone":     text = "\(who) un-ticked \(what)"
        case "chore_skipped":    text = "\(who) passed \(what) on to \(to)"
        case "swap_asked":       text = "\(who) asked \(to) to take \(what)"
        case "swap_accepted":    text = "\(who) took over \(what) from \(from)"
        case "swap_declined":    text = "\(who) couldn't take \(what) for \(from)"
        default:                 text = "\(who) changed something"
        }
        var s = AttributedString(text)
        // the thing it happened to, picked out of the sentence
        if !what.isEmpty, let r = s.range(of: what) { s[r].font = .system(size: 14.5, weight: .semibold) }
        return s
    }

    private var when: String {
        guard let d = ISO8601DateFormatter.heimat.date(from: a.at) else { return "" }
        return showsTime ? d.formatted(date: .omitted, time: .shortened) : Fmt.relDay(Fmt.ymd(d))
    }
}
