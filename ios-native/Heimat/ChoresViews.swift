import SwiftUI

// MARK: - Chores (docs/chores-screens.md)

/// A group's chores: requests waiting for you, this period's turn of each chore
/// with a tick circle, this month's points, and Add chore. Tapping a chore offers
/// skip, swap and edit.
struct ChoresSection: View {
    @Environment(AppModel.self) private var m
    let flatId: String

    var body: some View {
        let list = m.chores(in: flatId)
        let asks = m.choreSwaps.filter { $0.flatId == flatId && $0.toUser == m.uid }
        let board = m.choreBoard(in: flatId)
        VStack(alignment: .leading, spacing: 8) {
            Text("Chores").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).padding(.leading, 4)
            ForEach(asks) { SwapAskCard(swap: $0) }
            HeimatCard(radius: 22, padding: 0) {
                VStack(spacing: 0) {
                    ForEach(list) { c in
                        ChoreRowView(chore: c)
                        RowDivider(inset: 56)
                    }
                    if !board.isEmpty {
                        HStack(spacing: 10) {
                            Image(systemName: "trophy.fill").foregroundStyle(.yellow).frame(width: 30)
                            Text("This month: " + board.prefix(4).map { "\($0.user == m.uid ? "you" : m.personName($0.user)) \($0.points)" }.joined(separator: " · "))
                                .font(.system(size: 13.5, weight: .medium)).lineLimit(2)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        RowDivider(inset: 56)
                    }
                    Button { m.sheet = .chore(nil, flatId) } label: {
                        Label(list.isEmpty ? "Add bathroom, kitchen or trash" : "Add chore", systemImage: "plus.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 14)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    .disabled(m.uid == nil)
                }
            }
        }
    }
}

struct ChoreRowView: View {
    @Environment(AppModel.self) private var m
    let chore: Chore
    @State private var busy = false
    @State private var asking = false

    var body: some View {
        let (now, next) = m.turns(of: chore)
        let started = (now?.startsOn ?? "9999") <= Fmt.today()
        let done = now?.state == "done"
        let mine = now?.assignee == m.uid && now?.state == "open"
        HStack(spacing: 12) {
            Button {
                guard let now, started, !busy else { return }
                Haptic.tap(); busy = true
                Task { await m.tickChore(now, done: !done); busy = false }
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 26))
                    .foregroundStyle(done ? AnyShapeStyle(Color.hGreen) : mine ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.tertiary))
                    .frame(width: 30, height: 30)
                    .opacity(busy || !started ? 0.4 : 1)
            }
            .buttonStyle(.plain)
            .disabled(!started)
            .accessibilityLabel(done ? "Done — tap to undo" : "Mark \(chore.name) as done")

            Button { asking = true } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(chore.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        Text(line(now, next, started: started))
                            .font(.system(size: 12.5)).foregroundStyle(mine ? Color.accentColor : Color.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    Text("\(chore.points) pt\(chore.points == 1 ? "" : "s")")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .foregroundStyle(.primary)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .confirmationDialog(chore.name, isPresented: $asking, titleVisibility: .visible) {
            if mine, let now {
                if next?.assignee != nil && next?.assignee != m.uid {
                    Button("Skip this turn") { Task { await m.skipChore(now) } }
                }
                ForEach(m.members(of: chore.flatId).filter { !$0.isPending && $0.userId != m.uid }) { p in
                    Button("Ask \(p.displayName) to take it") { Task { await m.askSwap(now, to: p.userId) } }
                }
            }
            Button("Edit chore") { m.sheet = .chore(chore, chore.flatId) }
        } message: {
            if mine { Text("Skip passes it on and your turn comes back next time. A swap changes only when they say yes.") }
        }
    }

    private func who(_ u: String?) -> String { u == nil ? "nobody" : u == m.uid ? "Your" : "\(m.personName(u!))'s" }

    private func line(_ now: ChoreTurn?, _ next: ChoreTurn?, started: Bool) -> String {
        guard let now else { return Chore.label(chore.cadence) }
        if now.state == "done" {
            let by = now.doneBy.map { $0 == m.uid ? "you" : m.personName($0) } ?? "someone"
            return "Done ✓ by \(by)" + (next?.assignee).map { " · next: \($0 == m.uid ? "you" : m.personName($0))" }.orEmpty
        }
        if !started {
            let first = now.assignee.map { $0 == m.uid ? "you" : m.personName($0) } ?? "nobody"
            return "Starts \(Fmt.relDay(now.startsOn)) · \(first) first"
        }
        let until = now.endsOn == Fmt.today() ? "last day today" : "until \(Fmt.relDay(now.endsOn))"
        return "\(who(now.assignee)) turn · \(until)"
    }
}

private extension Optional where Wrapped == String {
    var orEmpty: String { self ?? "" }
}

/// "Bea asks if you can take Bathroom" — Accept / Decline.
struct SwapAskCard: View {
    @Environment(AppModel.self) private var m
    let swap: ChoreSwap

    var body: some View {
        let name = m.chores.first { $0.id == swap.choreId }?.name ?? "a chore"
        HeimatCard(radius: 20, padding: 14, tinted: true) {
            VStack(alignment: .leading, spacing: 10) {
                Text("\(m.personName(swap.fromUser)) asks if you can take their turn: \(name)")
                    .font(.system(size: 15, weight: .semibold))
                HStack(spacing: 10) {
                    Button("Decline") { Task { await m.answerSwap(swap, accept: false) } }.buttonStyle(.glass)
                    Button("I'll do it") { Task { await m.answerSwap(swap, accept: true) } }.buttonStyle(.glassProminent)
                }
                .controlSize(.small)
            }
        }
    }
}

/// Add or edit a chore: its name, how often, from when, its size, and who takes part (in turn order).
struct ChoreForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let editing: Chore?
    let flatId: String
    @State private var name = ""
    @State private var cadence = "weekly"
    @State private var start = Date()
    @State private var points = 1
    @State private var rota: [String] = []
    @State private var saving = false
    @State private var confirmDelete = false

    private var people: [Member] { m.members(of: flatId).filter { !$0.isPending } }

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("e.g. Bathroom", text: $name) }
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Chore.presets, id: \.self) { p in
                                Button(Chore.label(p)) { Haptic.tap(); cadence = p }
                                    .buttonStyle(.bordered).buttonBorderShape(.capsule)
                                    .tint(cadence == p ? .accentColor : .secondary)
                            }
                        }
                    }
                    Stepper(Chore.label(cadence), value: Binding(get: { Chore.parse(cadence).n }, set: { cadence = Chore.cadence($0, Chore.parse(cadence).unit) }), in: 1...99)
                    Picker("Unit", selection: Binding(get: { Chore.parse(cadence).unit }, set: { cadence = Chore.cadence(Chore.parse(cadence).n, $0) })) {
                        Text("Days").tag("d"); Text("Weeks").tag("w"); Text("Months").tag("m")
                    }
                    .pickerStyle(.segmented)
                } header: { Text("How often") } footer: { Text("Pick one, or set any number of days, weeks or months.") }
                Section {
                    DatePicker("First turn starts", selection: $start, displayedComponents: .date)
                    Picker("Size", selection: $points) { ForEach(Chore.sizes, id: \.0) { Text("\($0.1) · \($0.0) pt\($0.0 == 1 ? "" : "s")").tag($0.0) } }
                } footer: { Text("Bigger chores earn more points on this month's table.") }
                Section {
                    ForEach(people) { p in
                        Button {
                            Haptic.tap()
                            if let i = rota.firstIndex(of: p.userId) { rota.remove(at: i) } else { rota.append(p.userId) }
                        } label: {
                            HStack {
                                Text(p.userId == m.uid ? "You" : p.displayName).foregroundStyle(.primary)
                                Spacer()
                                if let i = rota.firstIndex(of: p.userId) {
                                    Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                                        .frame(width: 24, height: 24).background(Color.accentColor, in: Circle())
                                } else {
                                    Image(systemName: "circle").font(.title3).foregroundStyle(.tertiary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: { Text("Who takes part") } footer: { Text("Turns go round in this order. Tap to take someone out or put them back at the end.") }
                if editing != nil {
                    Section { Button("Remove chore", role: .destructive) { confirmDelete = true } }
                }
            }
            .navigationTitle(editing == nil ? "New chore" : "Edit chore")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || rota.isEmpty || saving || m.uid == nil)
                }
            }
            .confirmationDialog("Remove \(editing?.name ?? "this chore")? Its points this month stay.", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { if let c = editing { Task { await m.deleteChore(c); dismiss() } } }
            }
            .onAppear {
                if let c = editing {
                    name = c.name; cadence = c.cadence; start = Fmt.date(c.anchorOn) ?? Date(); points = c.points
                    rota = c.rota.filter { u in people.contains { $0.userId == u } }
                } else {
                    rota = people.map(\.userId)
                    // weekly chores start on a Monday
                    let cal = Calendar(identifier: .iso8601)
                    start = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date())) ?? Date()
                }
            }
        }
    }

    private func save() {
        saving = true
        let row = AppModel.ChoreRow(flat_id: flatId, name: name.trimmingCharacters(in: .whitespaces), cadence: cadence,
                                    anchor_on: Fmt.ymd(start), points: points, rota: rota)
        Task {
            if await m.saveChore(id: editing?.id, row) { dismiss() }
            saving = false
        }
    }
}
