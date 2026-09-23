import SwiftUI

/// The Home tab, laid out the way Heimat has always been: a hero balance card,
/// a row of shortcuts, the two status tiles side by side, then recent activity.
/// A free-form column rather than a grouped `List`, because the grid of tiles
/// has no equivalent in a list.
struct HomeView: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if m.flat != nil { balance() } else { noFlat }
                    quickActions
                    if !m.standings.isEmpty { people }
                    tiles
                    if m.flat != nil && m.isAnon { guest }
                    if m.flat != nil { recent }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .refreshable { await m.reload() }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top) {
                HeimatHeader(kicker: Fmt.greeting(), title: m.firstName.isEmpty ? "Heimat" : m.firstName)
            }
            .heimatScreen()
        }
    }

    // MARK: - Hero

    /// Where you stand everywhere at once, rather than in whichever flat
    /// happens to be open — the question Home is actually asked.
    private func balance() -> some View {
        let net = m.overallNet
        let owed = net > 0.5, owing = net < -0.5
        let status = owed ? "you are owed" : owing ? "you owe" : "all settled up"
        let home = abs(net) > 0.5 ? m.fHome(abs(net)).map { " · ≈ \($0)" } ?? "" : ""
        // when money runs both ways the single figure hides half the story
        let both = m.owedToMe > 0.5 && m.iOwe > 0.5
        let scope = m.flats.count > 1 ? "Across \(m.flats.count) flats and groups" : "Your balance"
        return HeimatCard(radius: 28, padding: 18, tinted: true) {
            VStack(alignment: .leading, spacing: 0) {
                Text(scope)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(.secondary).lineLimit(1)
                Text((owing ? "−" : owed ? "+" : "") + m.fH(abs(net)))
                    .font(.system(size: 44, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(owed ? Color.hGreen : owing ? Color.hRed : Color.primary)
                    .contentTransition(.numericText(value: net))
                    .minimumScaleFactor(0.6).lineLimit(1)
                    .padding(.top, 4)
                Text(status + home)
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                    .padding(.top, 4)
                if both {
                    HStack(spacing: 6) {
                        Text("you owe \(Text(m.fH(m.iOwe)).bold().foregroundColor(.hRed))")
                        Text("·").foregroundStyle(.tertiary)
                        Text("you're owed \(Text(m.fH(m.owedToMe)).bold().foregroundColor(.hGreen))")
                    }
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .padding(.top, 6)
                }
                HStack(spacing: 10) {
                    Button { m.startAddExpense() } label: {
                        Label("Add expense", systemImage: "plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    Button { m.sheet = .settle(nil) } label: {
                        Label("Settle up", systemImage: "arrow.left.arrow.right").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                }
                .controlSize(.large)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 18)
            }
        }
        .animation(.smooth, value: net)
    }

    /// One row per person, netted across every flat you share with them —
    /// two people can be square in one flat and not in another, and what you
    /// want to know is the single number between you.
    private var people: some View {
        VStack(spacing: 0) {
            SectionLabel("Who owes who").padding(.bottom, 10)
            HeimatCard(radius: 24, padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(m.standings.enumerated()), id: \.element.id) { i, s in
                        let owesMe = s.amount > 0
                        Button {
                            m.sheet = .settle(Calc.Suggestion(
                                from: owesMe ? s.person.userId : (m.uid ?? ""),
                                to: owesMe ? (m.uid ?? "") : s.person.userId,
                                amount: abs(s.amount)))
                        } label: {
                            HStack(spacing: 13) {
                                AvatarView(name: s.person.displayName, seed: s.person.userId, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.person.displayName).font(.system(size: 15.5, weight: .semibold))
                                    Text(s.flats.joined(separator: " · "))
                                        .font(.system(size: 12.5)).foregroundStyle(.tertiary).lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(m.fH(abs(s.amount)))
                                        .font(.system(size: 15.5, weight: .bold)).monospacedDigit()
                                        .foregroundStyle(owesMe ? Color.hGreen : Color.hRed)
                                    Text(owesMe ? "owes you" : "you owe")
                                        .font(.system(size: 11.5)).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 13)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressStyle())
                        .foregroundStyle(.primary)
                        if i < m.standings.count - 1 { RowDivider() }
                    }
                }
            }
        }
    }

    private var noFlat: some View {
        HeimatCard(radius: 28, padding: 18, tinted: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(Tint.green.gradient, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Share bills with flatmates").font(.system(size: 18, weight: .bold))
                        Text("Create a flat and invite them with a code — or join theirs. Bills sync live between your phones.")
                            .font(.system(size: 14)).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 10) {
                    Button { m.sheet = .flat(.create) } label: {
                        Label("Create flat", systemImage: "plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    Button { m.sheet = .flat(.join) } label: {
                        Label("Join", systemImage: "key.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                }
                .controlSize(.large)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .disabled(m.uid == nil)
                .padding(.top, 18)

                if m.isAnon {
                    Button("Been here before? Sign in") { m.sheet = .auth(.signin) }
                        .buttonStyle(.borderless)
                        .font(.system(size: 13.5, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                }
            }
        }
    }

    // MARK: - Shortcuts

    private var quickActions: some View {
        HStack(spacing: 10) {
            if m.flat != nil {
                QuickAction(symbol: "plus", tint: Tint.green, label: "Expense") { m.startAddExpense() }
                QuickAction(symbol: "clock.fill", tint: Tint.orange, label: "Log shift") { m.sheet = .shift(nil, nil) }
                QuickAction(symbol: "cart.fill", tint: Tint.pink, label: "List", badge: m.openItems) { m.sheet = .list }
                QuickAction(symbol: "chart.line.uptrend.xyaxis", tint: Tint.blue, label: "Analytics") { m.sheet = .analytics }
            } else {
                QuickAction(symbol: "clock.fill", tint: Tint.orange, label: "Log shift") { m.sheet = .shift(nil, nil) }
            }
        }
    }

    // MARK: - Status tiles

    /// Work limit, full width now that it is the only status card.
    private var tiles: some View {
        let ws = m.work
        return HeimatCard(radius: 24, padding: 14, action: { m.tab = .work }) {
            HStack(spacing: 14) {
                ring(pct: ws.daysUsed / Double(ws.budget), color: tone(ws.tone),
                     value: Fmt.num(ws.daysUsed, ws.daysUsed.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1),
                     unit: "days")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Work limit").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                    Text("\(Fmt.num(ws.weekH)) h of \(ws.weekCap) h this week")
                        .font(.system(size: 16, weight: .bold)).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Text("\(Fmt.num(ws.daysUsed, ws.daysUsed.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1)) of \(ws.budget) work days this year")
                        .font(.system(size: 12))
                        .foregroundStyle(ws.weekH > Double(ws.weekCap) ? Color.hRed : Color.secondary.opacity(0.8))
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
    }

    private func ring(pct: Double, color: Color, value: String, unit: String) -> some View {
        ZStack {
            Ring(pct: pct, color: color, line: 6)
            VStack(spacing: -1) {
                Text(value).font(.system(size: 15, weight: .heavy))
                Text(unit).font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
        .frame(width: 54, height: 54)
    }

    // MARK: - Rest

    private var guest: some View {
        HeimatCard(radius: 22, padding: 14, action: { m.sheet = .auth(.signup) }) {
            HStack(spacing: 12) {
                SettingIcon(symbol: "exclamationmark.shield.fill", color: Tint.orange)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Save your account").font(.system(size: 15, weight: .semibold))
                    Text("As a guest, your place in the flat lives on this phone only.")
                        .font(.system(size: 12.5)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
    }

    private var recent: some View {
        VStack(spacing: 0) {
            SectionLabel(text: "Recent activity") {
                if !m.expenses.isEmpty {
                    Button("See all") { m.tab = .flat }
                        .font(.system(size: 13.5, weight: .semibold))
                }
            }
            .padding(.bottom, 10)

            HeimatCard(radius: 24, padding: 0) {
                if m.expenses.isEmpty {
                    Text("No shared expenses yet. Add the first one — rent, groceries, the internet bill — and Heimat splits it.")
                        .font(.system(size: 14)).foregroundStyle(.secondary)
                        .padding(18)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(m.expenses.prefix(5).enumerated()), id: \.element.id) { i, e in
                            Button { m.open(e) } label: {
                                ExpenseRowView(e: e).padding(.horizontal, 14).padding(.vertical, 11)
                            }
                            .buttonStyle(PressStyle())
                            if i < min(m.expenses.count, 5) - 1 {
                                Divider().padding(.leading, 64)
                            }
                        }
                    }
                }
            }
        }
    }
}
