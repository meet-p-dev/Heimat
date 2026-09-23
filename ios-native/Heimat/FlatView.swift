import SwiftUI
import Charts

struct FlatView: View {
    @Environment(AppModel.self) private var m
    @State private var confirmLeave = false
    @State private var deleting: Expense?

    var body: some View {
        NavigationStack {
            Group {
                if let flat = m.flat { content(flat) } else { NoFlatView() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) {
                HeimatHeader(kicker: Fmt.longToday(), title: m.flat?.name ?? "Flat")
            }
            .heimatScreen()
        }
    }

    private var flatMenu: some View {
        Menu {
            if m.flats.count > 1 {
                Picker("Flat", selection: Binding(get: { m.flatId ?? "" }, set: { m.switchFlat($0) })) {
                    ForEach(m.flats) { Text($0.name).tag($0.id) }
                }
                Divider()
            }
            Button { m.sheet = .flat(.create) } label: { Label("New flat", systemImage: "plus") }
            Button { m.sheet = .flat(.join) } label: { Label("Join with a code", systemImage: "key.fill") }
        } label: {
            Image(systemName: "building.2")
        }
        .accessibilityLabel("Switch or add flat")
    }

    private func content(_ flat: Flat) -> some View {
        let suggestions = Calc.suggestions(m.balances)
        return ScrollView {
            VStack(spacing: 14) {
                flatPicker
                header(flat)
                balances(suggestions)
                actions
                shortcuts
                if m.expenses.isEmpty { emptyExpenses } else { months }
                leave(flat)
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .refreshable { await m.loadFlat() }
        .confirmationDialog("Leave this flat? You'll stop seeing its shared bills.", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave flat", role: .destructive) { Task { await m.leaveFlat() } }
        }
        .confirmationDialog("Delete this expense for everyone in the flat?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete expense", role: .destructive) { if let e = deleting { Task { await m.deleteExpense(e.id) } } }
        }
    }

    /// The flats you belong to, plus the two ways to get another one.
    private var flatPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                if m.flats.count > 1 {
                    ForEach(m.flats) { f in
                        Chip(text: f.name, symbol: f.isGroup ? "person.2.fill" : nil, on: f.id == m.flatId) { m.switchFlat(f.id) }
                    }
                }
                Chip(text: "New group", symbol: "plus", dashed: true) { m.sheet = .flat(.group) }
                Chip(text: "New flat", symbol: "plus", dashed: true) { m.sheet = .flat(.create) }
                Chip(text: "Join with code", symbol: "key.fill", dashed: true) { m.sheet = .flat(.join) }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .blocksTabSwipe()
        .padding(.horizontal, -16)
    }

    private func header(_ flat: Flat) -> some View {
        HeimatCard(radius: 28, padding: 18, tinted: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(flat.name)
                            .font(.system(size: 22, weight: .bold)).lineLimit(1)
                        Button {
                            UIPasteboard.general.string = flat.joinCode
                            Haptic.success()
                            m.show("Flat code copied")
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "doc.on.doc").font(.system(size: 11, weight: .bold))
                                Text(flat.joinCode).font(.system(size: 12, weight: .bold)).kerning(0.6)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Color.accentColor.opacity(0.16), in: Capsule())
                            .foregroundStyle(Color.accentColor)
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityLabel("Copy flat code \(flat.joinCode)")
                    }
                    Spacer(minLength: 8)
                    Button { m.sheet = .invite } label: {
                        Label("Invite", systemImage: "person.badge.plus")
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
                }
                HStack(spacing: 0) {
                    ForEach(Array(m.members.prefix(6).enumerated()), id: \.element.id) { i, mem in
                        AvatarView(name: mem.displayName, seed: mem.userId, size: 30)
                            .overlay(Circle().strokeBorder(Color.primary.opacity(0.001), lineWidth: 0))
                            .padding(.leading, i == 0 ? 0 : -9)
                            .zIndex(Double(6 - i))
                    }
                    Text(peopleLine(flat))
                        .font(.system(size: 13.5)).foregroundStyle(.secondary)
                        .padding(.leading, 10)
                    Spacer(minLength: 0)
                }
                .padding(.top, 16)
            }
        }
    }

    /// "4 flatmates · 1 invited" — an invited person is already splitting bills,
    /// so they are counted, just marked as not here yet.
    private func peopleLine(_ flat: Flat) -> String {
        let waiting = m.members.filter(\.isPending).count
        let noun = flat.isGroup ? "people" : "flatmates"
        let base = m.members.count == 1
            ? (flat.isGroup ? "Just you — add the people you split with" : "1 person — invite your flatmates")
            : "\(m.members.count) \(noun)"
        return waiting > 0 ? "\(base) · \(waiting) invited" : base
    }

    private func balances(_ suggestions: [Calc.Suggestion]) -> some View {
        VStack(spacing: 0) {
            SectionLabel("Balances").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(m.members.enumerated()), id: \.element.id) { i, mem in
                        let net = m.balances[mem.userId] ?? 0
                        let owes = suggestions.filter { $0.from == mem.userId }
                        let gets = suggestions.filter { $0.to == mem.userId }
                        HStack(alignment: .top, spacing: 13) {
                            AvatarView(name: mem.displayName, seed: mem.userId, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(mem.displayName + (mem.userId == m.uid ? " (you)" : ""))
                                        .font(.system(size: 15.5, weight: .semibold))
                                    if mem.isPending {
                                        Text("invited").font(.system(size: 10.5, weight: .bold))
                                            .padding(.horizontal, 7).padding(.vertical, 2)
                                            .background(Color.secondary.opacity(0.16), in: Capsule())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                if owes.isEmpty && gets.isEmpty {
                                    Text("settled up").font(.system(size: 12.5)).foregroundStyle(.tertiary)
                                }
                                ForEach(owes, id: \.self) { s in
                                    Text("owes \(Text(m.fH(s.amount)).bold().foregroundColor(.hRed)) to \(m.nameOf(s.to))")
                                        .font(.system(size: 12.5)).foregroundStyle(.secondary)
                                }
                                ForEach(gets, id: \.self) { s in
                                    Text("gets \(Text(m.fH(s.amount)).bold().foregroundColor(.hGreen)) from \(m.nameOf(s.from))")
                                        .font(.system(size: 12.5)).foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 8)
                            Text(net > 0.5 ? "+\(m.fH(net))" : net < -0.5 ? "−\(m.fH(-net))" : "—")
                                .font(.system(size: 15, weight: .bold)).monospacedDigit()
                                .foregroundStyle(net > 0.5 ? Color.hGreen : net < -0.5 ? Color.hRed : Color.secondary)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        if i < m.members.count - 1 { RowDivider(inset: 69) }
                    }
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 10) {
            Button { m.sheet = .settle(nil) } label: {
                Label("Settle up", systemImage: "arrow.left.arrow.right").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            Button { m.startAddExpense() } label: {
                Label("Add expense", systemImage: "plus").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
        }
        .controlSize(.large)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }

    private var shortcuts: some View {
        HeimatCard(radius: 22, padding: 0) {
            VStack(spacing: 0) {
                HeimatRow(symbol: "cart.fill", tint: Tint.pink, label: "Shopping list",
                          sub: m.openItems > 0 ? "\(m.openItems) to buy" : "Nothing to buy") { m.sheet = .list }
                RowDivider()
                HeimatRow(symbol: "chart.line.uptrend.xyaxis", tint: Tint.blue, label: "Analytics",
                          sub: "Spend trend, categories and who paid") { m.sheet = .analytics }
            }
        }
    }

    private var emptyExpenses: some View {
        HeimatCard(radius: 26, padding: 22) {
            VStack(spacing: 10) {
                Image(systemName: "receipt").font(.system(size: 34)).foregroundStyle(.tertiary)
                Text("No shared expenses yet").font(.system(size: 17, weight: .bold))
                Text("Add rent, groceries or the internet bill — Heimat splits it and keeps score for everyone.")
                    .font(.system(size: 14)).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Add the first expense") { m.startAddExpense() }
                    .buttonStyle(.glassProminent).controlSize(.large).padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var months: some View {
        ForEach(m.months, id: \.key) { g in
            VStack(spacing: 0) {
                SectionLabel(text: g.label) {
                    Text(m.fH(g.total))
                        .font(.system(size: 13)).foregroundStyle(.tertiary).monospacedDigit()
                }
                .padding(.bottom, 10)
                HeimatCard(radius: 24, padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(g.list.enumerated()), id: \.element.id) { i, e in
                            Button { m.open(e) } label: {
                                ExpenseRowView(e: e).padding(.horizontal, 14).padding(.vertical, 11)
                            }
                            .buttonStyle(PressStyle())
                            .swipeActions {
                                if m.canEdit(e) { Button("Delete", systemImage: "trash", role: .destructive) { deleting = e } }
                            }
                            if i < g.list.count - 1 { RowDivider(inset: 64) }
                        }
                    }
                }
            }
        }
    }

    private func leave(_ flat: Flat) -> some View {
        Button(role: .destructive) { confirmLeave = true } label: {
            Label("Leave “\(flat.name)”", systemImage: "rectangle.portrait.and.arrow.right")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .tint(.hRed)
        .padding(.top, 12)
    }
}

struct NoFlatView: View {
    @Environment(AppModel.self) private var m
    var body: some View {
        ContentUnavailableView {
            Label("Your shared flat", systemImage: "person.2.fill")
        } description: {
            Text("Create a flat and invite your flatmates, or join theirs with a code. Shared bills sync between your phones live.")
        } actions: {
            VStack(spacing: 10) {
                Button { m.sheet = .flat(.create) } label: { Label("Create a flat", systemImage: "plus").frame(maxWidth: 260) }
                    .buttonStyle(.glassProminent)
                Button { m.sheet = .flat(.join) } label: { Label("Join with a code", systemImage: "key.fill").frame(maxWidth: 260) }
                    .buttonStyle(.glass)
                if m.isAnon { Button("Been here before? Sign in") { m.sheet = .auth(.signin) }.padding(.top, 6) }
            }
            .controlSize(.large)
            .disabled(m.uid == nil)
        }
    }
}

// MARK: - Shopping list

struct ShoppingListView: View {
    @Environment(AppModel.self) private var m
    @State private var title = ""
    @State private var cat = "groceries"

    var body: some View {
        let open = m.items.filter { !$0.bought }, bought = m.items.filter(\.bought)
        List {
            Section {
                HStack {
                    TextField("Milk, toilet paper, call landlord…", text: $title).onSubmit(add)
                    Button(action: add) { Image(systemName: "plus.circle.fill").font(.title2) }
                        .buttonStyle(.borderless)
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel("Add to list")
                }
                Picker("Category", selection: $cat) {
                    ForEach(m.cats) { Label($0.label, systemImage: $0.symbol).tag($0.id) }
                }
            }
            if open.isEmpty && bought.isEmpty {
                ContentUnavailableView("Nothing on the list", systemImage: "cart", description: Text("Add what the flat needs. Whoever goes shopping ticks things off, and everyone sees it instantly."))
            }
            if !open.isEmpty {
                Section("To buy · \(open.count)") {
                    ForEach(open) { it in row(it) }
                        .onDelete { idx in idx.forEach { i in Task { await m.deleteItem(open[i].id) } } }
                }
            }
            if !bought.isEmpty {
                Section {
                    ForEach(bought) { it in row(it) }
                        .onDelete { idx in idx.forEach { i in Task { await m.deleteItem(bought[i].id) } } }
                } header: {
                    Text("Bought · \(bought.count)")
                } footer: {
                    HStack(spacing: 10) {
                        Button { m.expenseFromBought() } label: { Label("Add as expense", systemImage: "receipt").frame(maxWidth: .infinity) }
                            .buttonStyle(.glassProminent)
                        AsyncButton(action: { await m.clearBought() }) { Label("Clear", systemImage: "trash") }
                            .buttonStyle(.glass)
                    }
                    .controlSize(.large)
                    .padding(.top, 10)
                }
            }
        }
        .navigationTitle("Shopping list")
        .heimatSurface()
        .refreshable { await m.loadFlat() }
    }

    private func row(_ it: ListItem) -> some View {
        let c = Cats.of(m.cats, it.category)
        return HStack(spacing: 12) {
            Button { Task { await m.setBought(it, !it.bought) } } label: {
                Image(systemName: it.bought ? "checkmark.circle.fill" : "circle")
                    .font(.title2).foregroundStyle(it.bought ? Color.green : Color.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(it.bought ? "Put \(it.title) back on the list" : "Mark \(it.title) as bought")
            VStack(alignment: .leading, spacing: 2) {
                Text(it.title).strikethrough(it.bought).foregroundStyle(it.bought ? .secondary : .primary)
                Text(it.bought ? "bought by \(it.boughtBy.map(m.nameOf) ?? "—")" : "\(c.label) · added by \(it.addedBy.map(m.nameOf) ?? "someone")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func add() {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        title = ""
        Task { await m.addItem(t, cat) }
    }
}

// MARK: - Analytics

struct AnalyticsView: View {
    @Environment(AppModel.self) private var m

    /// How far back the charts look. `all` exists because a flat that started
    /// mid-year otherwise shows a mostly empty year.
    enum Span: String, CaseIterable, Identifiable {
        case months6 = "6 months", year = "Year", all = "All"
        var id: String { rawValue }
        var count: Int? { self == .months6 ? 6 : self == .year ? 12 : nil }
    }

    @State private var span: Span = .months6
    /// A month key ("2026-09") when one bar is picked, nil for the whole span.
    @State private var month: String?
    @State private var openCategory: String?

    // MARK: Data

    /// Every month in the span, oldest first, including months with no spend —
    /// a gap in the run is information, so it should not be silently dropped.
    private var buckets: [(key: String, date: Date, total: Double)] {
        let keys: [String]
        if let n = span.count {
            let first = Fmt.date(String(Fmt.today().prefix(7)) + "-01")!
            keys = (0..<n).reversed().compactMap {
                Calendar.current.date(byAdding: .month, value: -$0, to: first).map { String(Fmt.ymd($0).prefix(7)) }
            }
        } else {
            keys = Set(m.expenses.map { String($0.spentOn.prefix(7)) }).sorted()
        }
        return keys.compactMap { k in
            guard let d = Fmt.date(k + "-01") else { return nil }
            return (k, d, m.expenses.filter { $0.spentOn.hasPrefix(k) }.reduce(0) { $0 + $1.amount })
        }
    }

    /// What every figure below is about: one month if you picked one, else the
    /// whole span. Keeping one source for this is what stops the headline total
    /// and the charts disagreeing.
    private var scoped: [Expense] {
        if let month { return m.expenses.filter { $0.spentOn.hasPrefix(month) } }
        let keys = Set(buckets.map(\.key))
        return m.expenses.filter { keys.contains(String($0.spentOn.prefix(7))) }
    }

    private var scopeLabel: String {
        if let month { return Fmt.monthLabel(month + "-01") }
        switch span {
        case .months6: return "Last 6 months"
        case .year: return "Last 12 months"
        case .all: return "All time"
        }
    }

    private var total: Double { scoped.reduce(0) { $0 + $1.amount } }

    private var slices: [(cat: Cat, total: Double, items: [Expense])] {
        Dictionary(grouping: scoped) { $0.category ?? "other" }
            .map { (Cats.of(m.cats, $0.key), $0.value.reduce(0) { $0 + $1.amount }, $0.value.sorted { $0.spentOn > $1.spentOn }) }
            .sorted { $0.1 > $1.1 }
    }

    private var payers: [(name: String, total: Double)] {
        m.members
            .map { mem in
                (mem, m.nameOf(mem.userId), scoped.filter { $0.paidBy == mem.userId }.reduce(0) { $0 + $1.amount })
            }
            .filter { $0.2 > 0 }
            .sorted { $0.2 > $1.2 }
            .map { (name: $0.1, total: $0.2) }
    }

    // MARK: View

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                header
                trend
                categories
                if !payers.isEmpty { whoPaid }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .navigationTitle("Analytics")
        .heimatScreen()
        .animation(.smooth(duration: 0.28), value: month)
        .animation(.smooth(duration: 0.28), value: span)
    }

    private var header: some View {
        HeimatCard(radius: 28, padding: 18, tinted: true) {
            VStack(alignment: .leading, spacing: 10) {
                Picker("Span", selection: $span) { ForEach(Span.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)
                    .onChange(of: span) { _, _ in month = nil; openCategory = nil }

                HStack(alignment: .firstTextBaseline) {
                    Text(scopeLabel).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.secondary)
                    Spacer()
                    if month != nil {
                        Button("Show all") { month = nil; openCategory = nil }
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                Text(m.fH(total))
                    .font(.system(size: 36, weight: .heavy)).monospacedDigit()
                    .contentTransition(.numericText(value: total))
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text("group spend · your share \(m.fH(Calc.myShare(scoped, uid: m.uid)))")
                    .font(.system(size: 13.5)).foregroundStyle(.secondary)
            }
        }
    }

    /// Bars rather than a line: a bar is a target you can actually hit with a
    /// thumb, and picking one is how you drill into a month.
    private var trend: some View {
        VStack(spacing: 0) {
            SectionLabel(text: "Spend by month") {
                if month != nil { Text("tap again to clear").font(.system(size: 12)).foregroundStyle(.tertiary) }
            }
            .padding(.bottom, 10)

            HeimatCard(radius: 24, padding: 14) {
                if buckets.allSatisfy({ $0.total == 0 }) {
                    Text("No spending recorded yet.")
                        .font(.system(size: 14)).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    Chart(buckets, id: \.key) { b in
                        BarMark(x: .value("Month", b.date, unit: .month),
                                y: .value("Spend", b.total))
                            .foregroundStyle(month == nil || month == b.key
                                             ? Color.accentColor : Color.accentColor.opacity(0.22))
                            .cornerRadius(6)
                    }
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .month)) { _ in
                            AxisValueLabel(format: .dateTime.month(.narrow))
                        }
                    }
                    .chartYAxis { AxisMarks(position: .trailing) }
                    .chartOverlay { proxy in
                        GeometryReader { geo in
                            Rectangle().fill(.clear).contentShape(Rectangle())
                                .onTapGesture { p in
                                    guard let plot = proxy.plotFrame else { return }
                                    let x = p.x - geo[plot].origin.x
                                    guard let date: Date = proxy.value(atX: x) else { return }
                                    let key = String(Fmt.ymd(date).prefix(7))
                                    guard buckets.contains(where: { $0.key == key }) else { return }
                                    Haptic.tap()
                                    month = (month == key) ? nil : key
                                    openCategory = nil
                                }
                        }
                    }
                    .frame(height: 170)
                }
            }
        }
    }

    private var categories: some View {
        VStack(spacing: 0) {
            SectionLabel("By category").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 0) {
                if slices.isEmpty {
                    Text("Nothing spent in \(scopeLabel.lowercased()).")
                        .font(.system(size: 14)).foregroundStyle(.secondary)
                        .padding(18)
                } else {
                    VStack(spacing: 0) {
                        ZStack {
                            Chart(slices, id: \.cat.id) { s in
                                SectorMark(angle: .value("Spend", s.total),
                                           innerRadius: .ratio(0.64), angularInset: 1.5)
                                    .foregroundStyle(s.cat.color)
                                    .opacity(openCategory == nil || openCategory == s.cat.id ? 1 : 0.35)
                                    .cornerRadius(4)
                            }
                            .frame(height: 190)
                            // the total belongs in the hole, not in a legend
                            VStack(spacing: 1) {
                                Text(m.fH(total)).font(.system(size: 17, weight: .heavy))
                                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                                Text(month == nil ? scopeLabel : Fmt.monthLabel(month! + "-01"))
                                    .font(.system(size: 10)).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 30)
                        }
                        .padding(.top, 14)

                        ForEach(Array(slices.enumerated()), id: \.element.cat.id) { i, s in
                            if i > 0 { RowDivider(inset: 50) }
                            categoryRow(s)
                        }
                    }
                }
            }
        }
    }

    /// A category opens to the expenses behind it — the number on its own never
    /// answers "what was that?".
    @ViewBuilder private func categoryRow(_ s: (cat: Cat, total: Double, items: [Expense])) -> some View {
        let open = openCategory == s.cat.id
        VStack(spacing: 0) {
            Button {
                Haptic.tap()
                openCategory = open ? nil : s.cat.id
            } label: {
                HStack(spacing: 12) {
                    Circle().fill(s.cat.color).frame(width: 10, height: 10)
                    Text(s.cat.label).font(.system(size: 15, weight: .semibold))
                    Text("\(s.items.count)")
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(.fill.tertiary, in: Capsule())
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 6)
                    Text(m.fH(s.total)).font(.system(size: 15, weight: .semibold)).monospacedDigit()
                    Text(pct(s.total))
                        .font(.system(size: 12)).foregroundStyle(.tertiary)
                        .frame(width: 38, alignment: .trailing).monospacedDigit()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .foregroundStyle(.primary)

            if open {
                VStack(spacing: 0) {
                    ForEach(s.items) { e in
                        Button { m.open(e) } label: {
                            HStack(spacing: 10) {
                                Text((e.description ?? "").isEmpty ? s.cat.label : e.description!)
                                    .font(.system(size: 13.5)).lineLimit(1)
                                Spacer(minLength: 6)
                                Text("\(m.nameOf(e.paidBy)) · \(Fmt.relDay(e.spentOn))")
                                    .font(.system(size: 11.5)).foregroundStyle(.tertiary).lineLimit(1)
                                Text(m.fH(e.amount))
                                    .font(.system(size: 13.5, weight: .semibold)).monospacedDigit()
                            }
                            .padding(.leading, 38).padding(.trailing, 16).padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressStyle())
                        .foregroundStyle(.primary)
                    }
                }
                .padding(.bottom, 6)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.smooth(duration: 0.24), value: open)
    }

    private var whoPaid: some View {
        VStack(spacing: 0) {
            SectionLabel("Who paid").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 14) {
                Chart(payers, id: \.name) { p in
                    BarMark(x: .value("Paid", p.total), y: .value("Who", p.name))
                        .foregroundStyle(Color.accentColor.gradient)
                        .cornerRadius(6)
                        .annotation(position: .trailing, alignment: .leading) {
                            Text(m.fH(p.total))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary).monospacedDigit()
                        }
                }
                .chartXAxis(.hidden)
                .chartXScale(domain: 0...(payers.map(\.total).max() ?? 1) * 1.28)
                .frame(height: CGFloat(payers.count) * 42)
            }
        }
    }

    /// One decimal below 10%, so small categories do not all collapse to "0%".
    private func pct(_ v: Double) -> String {
        guard total > 0.005 else { return "—" }
        let p = v / total * 100
        return p < 9.95 ? String(format: "%.1f%%", p) : "\(Int(p.rounded()))%"
    }
}
