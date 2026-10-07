import SwiftUI

// MARK: - Chores (docs/chores-screens.md)

/// A group's chores. Each row shows whose turn it is — their face — and what to do:
/// "Done" when it's yours, a green tick once someone did it. Requests to take someone's
/// turn sit at the top until you answer; this month's points close the card. Tap a chore
/// for the rest: mark it done for someone, skip, ask someone to swap, edit.
struct ChoresSection: View {
    @Environment(AppModel.self) private var m
    let flatId: String

    var body: some View {
        let list = ordered
        let asks = m.choreSwaps.filter { $0.flatId == flatId && $0.toUser == m.uid }
        let board = m.choreBoard(in: flatId)
        VStack(spacing: 0) {
            SectionLabel(text: "Chores") {
                if !list.isEmpty { AddButton { m.sheet = .chore(nil, flatId) }.disabled(m.uid == nil) }
            }
            .padding(.bottom, 10)
            HeimatCard(radius: 22, padding: 0) {
                if list.isEmpty {
                    EmptyPrompt(symbol: "sparkles", tint: Tint.teal, title: "Take turns",
                                text: "Bathroom, kitchen, trash — Splitlife keeps the rota and tells each person when it's their turn.",
                                action: "Add a chore") { m.sheet = .chore(nil, flatId) }
                        .disabled(m.uid == nil)
                } else {
                    VStack(spacing: 0) {
                        ForEach(asks) { a in
                            SwapAskRow(swap: a)
                            RowDivider(inset: 0)
                        }
                        ForEach(Array(list.enumerated()), id: \.element.id) { i, c in
                            ChoreRowView(chore: c)
                            if i < list.count - 1 || !board.isEmpty { RowDivider(inset: 64) }
                        }
                        if !board.isEmpty { boardRow(board) }
                    }
                    // the tinted request row follows the card's corners
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                }
            }
        }
    }

    /// yours first, then the ones still open, done last
    private var ordered: [Chore] {
        func rank(_ c: Chore) -> Int {
            guard let t = m.turns(of: c).now else { return 2 }
            if t.state == "done" { return 3 }
            return t.assignee == m.uid && t.startsOn <= Fmt.today() ? 0 : 1
        }
        return m.chores(in: flatId).sorted { (rank($0), $0.name) < (rank($1), $1.name) }
    }

    /// this month's points: who has done the most
    private func boardRow(_ board: [(user: String, points: Int, done: Int)]) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "trophy.fill").font(.system(size: 15)).foregroundStyle(.yellow).frame(width: 36)
            Text("This month").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(board.prefix(6), id: \.user) { r in
                        HStack(spacing: 5) {
                            AvatarView(name: m.personName(r.user), seed: r.user, size: 20)
                            Text("\(r.points)").font(.system(size: 13, weight: .bold)).monospacedDigit()
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(r.user == m.uid ? "You" : m.personName(r.user)): \(r.points) points")
                    }
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
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
        let face = done ? now?.doneBy : now?.assignee
        Button { asking = true } label: {
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    if let face {
                        AvatarView(name: m.personName(face), seed: face, size: 38)
                    } else {
                        Image(systemName: "person.fill.questionmark").font(.system(size: 16))
                            .foregroundStyle(.secondary).frame(width: 38, height: 38)
                            .background(Color.secondary.opacity(0.12), in: Circle())
                    }
                    if done {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 16))
                            .foregroundStyle(.white, Color.hGreen).offset(x: 3, y: 3)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(chore.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        Text("\(chore.points) pt\(chore.points == 1 ? "" : "s")")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12), in: Capsule())
                    }
                    Text(line(now, next, started: started))
                        .font(.system(size: 12.5)).foregroundStyle(mine && started ? Color.accentColor : Color.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                if mine && started, let now {
                    Button {
                        guard !busy else { return }
                        Haptic.tap(); busy = true
                        Task { await m.tickChore(now, done: true); busy = false }
                    } label: { Text("Done").font(.system(size: 13, weight: .semibold)) }
                    .glassProminentButton()
                    .controlSize(.small)
                    .opacity(busy ? 0.5 : 1)
                    .accessibilityLabel("Mark \(chore.name) as done")
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .foregroundStyle(.primary)
        .confirmationDialog(chore.name, isPresented: $asking, titleVisibility: .visible) {
            if let now, started {
                if done {
                    Button("Not done after all") { Task { await m.tickChore(now, done: false) } }
                } else if !mine {
                    // someone did it for them: it counts for whoever ticks it
                    Button("I did it") { Task { await m.tickChore(now, done: true) } }
                }
            }
            if mine, let now {
                if next?.assignee != nil && next?.assignee != m.uid {
                    Button("Skip this turn") { Task { await m.skipChore(now) } }
                }
                ForEach(m.members(of: chore.flatId).filter { !$0.isPending && !$0.hasLeft && $0.userId != m.uid }) { p in
                    Button("Ask \(p.displayName) to take it") { Task { await m.askSwap(now, to: p.userId) } }
                }
            }
            Button("Edit chore") { m.sheet = .chore(chore, chore.flatId) }
        } message: {
            if mine { Text("Skip passes it to whoever is next, and your turn comes back after. A swap only happens when they say yes.") }
            else if !done && started { Text("\"I did it\" counts the points for you.") }
        }
    }

    private func name(_ u: String?) -> String { u == nil ? "nobody" : u == m.uid ? "you" : m.personName(u!) }

    private func line(_ now: ChoreTurn?, _ next: ChoreTurn?, started: Bool) -> String {
        guard let now else { return Chore.label(chore.cadence) }
        if now.state == "done" {
            return "Done by \(name(now.doneBy))" + (next?.assignee).map { " · next: \(name($0))" }.orEmpty
        }
        if !started { return "Starts \(Fmt.relDay(now.startsOn)) · \(name(now.assignee)) first" }
        let until = now.endsOn == Fmt.today() ? "last day today" : "until \(Fmt.relDay(now.endsOn))"
        let whose = now.assignee == m.uid ? "Your turn" : now.assignee == nil ? "Nobody's turn" : "\(m.personName(now.assignee!))'s turn"
        return "\(whose) · \(until)"
    }
}

private extension Optional where Wrapped == String {
    var orEmpty: String { self ?? "" }
}

/// "Dana asks you to take Vacuuming" — No / Take it, inside the Chores card.
struct SwapAskRow: View {
    @Environment(AppModel.self) private var m
    let swap: ChoreSwap

    var body: some View {
        let name = m.chores.first { $0.id == swap.choreId }?.name ?? "a chore"
        HStack(spacing: 12) {
            AvatarView(name: m.personName(swap.fromUser), seed: swap.fromUser, size: 38)
            Text("\(Text(m.personName(swap.fromUser)).bold()) asks you to take \(Text(name).bold())")
                .font(.system(size: 14)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            Button("No") { Task { await m.answerSwap(swap, accept: false) } }.glassButton()
            Button("Take it") { Task { await m.answerSwap(swap, accept: true) } }.glassProminentButton()
        }
        .controlSize(.small)
        .font(.system(size: 13, weight: .semibold))
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color.accentColor.opacity(0.08))
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
    /// a cadence that isn't one of the presets: shown as a number and a unit
    @State private var custom = false
    @State private var saving = false
    @State private var confirmDelete = false

    private var people: [Member] { m.members(of: flatId).filter { !$0.isPending } }

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("e.g. Bathroom", text: $name) } header: { Text("Chore") }
                Section {
                    // the usual ones in one menu; "Other" opens any number of days, weeks or months
                    Picker("How often", selection: Binding(
                        get: { custom ? "other" : cadence },
                        set: { v in
                            Haptic.tap()
                            withAnimation { if v == "other" { custom = true } else { custom = false; cadence = v } }
                        })) {
                        ForEach(Chore.presets, id: \.self) { Text(Chore.label($0)).tag($0) }
                        Text("Other…").tag("other")
                    }
                    if custom {
                        Stepper(Chore.label(cadence), value: Binding(get: { Chore.parse(cadence).n }, set: { cadence = Chore.cadence($0, Chore.parse(cadence).unit) }), in: 1...99)
                        Picker("Unit", selection: Binding(get: { Chore.parse(cadence).unit }, set: { cadence = Chore.cadence(Chore.parse(cadence).n, $0) })) {
                            Text("Days").tag("d"); Text("Weeks").tag("w"); Text("Months").tag("m")
                        }
                        .pickerStyle(.segmented)
                    }
                } footer: { Text("Each turn lasts this long, then it's the next person's.") }
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
                    custom = !Chore.presets.contains(c.cadence)
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
