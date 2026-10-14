import SwiftUI

/// The Home tab, laid out the way Heimat has always been: a hero balance card,
/// a row of shortcuts, the two status tiles side by side, then recent activity.
/// A free-form column rather than a grouped `List`, because the grid of tiles
/// has no equivalent in a list.
struct HomeView: View {
    @Environment(AppModel.self) private var m
    /// iOS hasn't asked yet — read once Home appears, since asking is async
    @State private var canAsk = false
    @AppStorage(Push.askedKey) private var pushAsked = false
    /// Activity on Home: your own newest expenses, or everything happening in your groups
    @AppStorage("mt-h-home-activity") private var feed: Feed = .mine
    /// "Get started" closed by hand (it also goes once every step is done)
    @AppStorage("mt-h-start-hidden") private var startHidden = false
    enum Feed: String { case mine, everything }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let u = m.update { updateCard(u).transition(.opacity.combined(with: .scale(scale: 0.96))) }
                    if hasPlace { balance() }
                    if !hasPlace || (!startHidden && !steps.allSatisfy(\.done)) { getStarted }
                    quickActions
                    if m.profile.on(.limit) { tiles }
                    if askPush { pushCard.transition(.opacity.combined(with: .scale(scale: 0.96))) }
                    if m.flat != nil && m.isAnon { guest }
                    if m.flat != nil || !m.circles.isEmpty { recent }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .refreshable {
                await m.reload()
                if feed == .everything { await m.loadActivity() }
            }
            .task { canAsk = await Push.shared.permission() == .notDetermined }
            .animation(.smooth, value: askPush)
            .animation(.smooth, value: m.update)
            .heimatHeader(kicker: Fmt.greeting(), title: m.firstName.isEmpty ? "Splitlife" : m.firstName)
            .heimatScreen()
        }
    }

    // MARK: - Hero

    /// Where you stand everywhere at once, rather than in whichever flat
    /// happens to be open — the question Home is actually asked.
    private func balance() -> some View {
        let net = m.overallNet
        // whole cents from the ledger: zero is settled, and nothing under 0,50 € is hidden any more
        let owed = net > 0, owing = net < 0
        let status = owed ? "you are owed" : owing ? "you owe" : "all settled up"
        let home = net != 0 ? m.fHome(abs(net)).map { " · ≈ \($0)" } ?? "" : ""
        // when money runs both ways the single figure hides half the story
        let both = m.owedToMe > 0 && m.iOwe > 0
        let places = m.flats.count + (m.circles.isEmpty ? 0 : 1)
        let scope = places > 1 ? "Across \(m.flats.count) \(m.flats.count == 1 ? "group" : "groups")" + (m.circles.isEmpty ? "" : " and friends") : "Your balance"
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
                    .glassProminentButton()
                    Button {
                        // with no group open, what there is to settle is with friends
                        if m.flat != nil { m.sheet = .settle(nil) } else { m.tab = .flat; m.groupsPath = [.nonGroup] }
                    } label: {
                        Label("Settle up", systemImage: "arrow.left.arrow.right").frame(maxWidth: .infinity)
                    }
                    .glassButton()
                }
                .controlSize(.large)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 18)
            }
        }
        .animation(.smooth, value: net)
    }

    // MARK: - Get started

    private var hasPlace: Bool { !m.flats.isEmpty || !m.circles.isEmpty }

    private struct Step: Identifiable {
        let id: String, title: String, sub: String, symbol: String, done: Bool
    }

    /// The first things a new person does, from their setup answers, each ticked off by
    /// what has actually happened — so the card is right on every phone, with no flags to sync.
    private var steps: [Step] {
        let share = m.profile.share ?? []
        let group: (String, String) =
            share.contains("flatmates") ? ("Set up your flat", "A group for your WG — invite your flatmates with a link.")
            : share.contains("partner") ? ("Start a group with your partner", "Rent, groceries, trips — always even.")
            : share.contains("family") ? ("Make a family group", "Share costs with family here or back home.")
            : share.contains("friends") ? ("Make a group with friends", "For a trip or a flat — or split one bill from Groups.")
            : ("Make your first group", "Or join one with the code a friend sent you.")
        var out = [
            Step(id: "group", title: group.0, sub: group.1, symbol: "person.3.fill", done: hasPlace),
            Step(id: "expense", title: "Add your first expense", sub: "Who paid, how much, and how to split it.", symbol: "plus", done: !m.allExpenses.isEmpty),
        ]
        if m.profile.on(.work) {
            out.append(Step(id: "shift", title: "Log a shift", sub: "Your pay this month, and an estimate of the tax.", symbol: "clock.fill", done: !m.shifts.isEmpty))
        }
        if m.isAnon {
            out.append(Step(id: "account", title: "Save it with a free account", sub: "So nothing is lost if you change phone.", symbol: "checkmark.shield.fill", done: false))
        }
        return out
    }

    private var getStarted: some View {
        let list = steps
        let next = list.first { !$0.done }?.id
        return HeimatCard(radius: 28, padding: 18, tinted: !hasPlace) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Get started").font(.system(size: 20, weight: .bold))
                        Text("\(list.filter(\.done).count) of \(list.count) done")
                            .font(.system(size: 13)).foregroundStyle(.secondary).monospacedDigit()
                    }
                    Spacer()
                    if hasPlace {
                        Button("Hide") { withAnimation(.smooth) { startHidden = true } }
                            .font(.system(size: 14, weight: .semibold)).buttonStyle(.borderless)
                    }
                }
                .padding(.bottom, 8)
                ForEach(list) { st in
                    if st.id != list.first?.id { RowDivider(inset: 44) }
                    stepRow(st, isNext: st.id == next)
                }
                if m.isAnon && !hasPlace {
                    Button("Been here before? Sign in") { m.sheet = .auth(.signin) }
                        .buttonStyle(.borderless)
                        .font(.system(size: 13.5, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                }
            }
        }
    }

    private func stepRow(_ st: Step, isNext: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: st.done ? "checkmark" : st.symbol)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(st.done || isNext ? .white : .secondary)
                    .frame(width: 30, height: 30)
                    .background(st.done ? AnyShapeStyle(Tint.green.gradient) : isNext ? AnyShapeStyle(Color.accentColor.gradient) : AnyShapeStyle(.fill.tertiary), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(st.title).font(.system(size: 15.5, weight: .semibold))
                        .strikethrough(st.done).foregroundStyle(st.done ? .secondary : .primary)
                    if isNext { Text(st.sub).font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 0)
            }
            if isNext { stepActions(st).padding(.leading, 42).padding(.top, 10) }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(st.done ? "\(st.title), done" : st.title)
    }

    @ViewBuilder private func stepActions(_ st: Step) -> some View {
        HStack(spacing: 10) {
            switch st.id {
            case "group":
                Button { m.sheet = .flat((m.profile.share ?? []).contains("flatmates") ? .create : .group) } label: {
                    Label("New group", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .glassProminentButton()
                Button { m.sheet = .flat(.join) } label: {
                    Label("Join", systemImage: "key.fill").frame(maxWidth: .infinity)
                }
                .glassButton()
            case "expense":
                Button { m.startAddExpense() } label: { Label("Add expense", systemImage: "plus").frame(maxWidth: .infinity) }
                    .glassProminentButton()
            case "shift":
                Button { m.sheet = .shift(nil, nil) } label: { Label("Log a shift", systemImage: "clock").frame(maxWidth: .infinity) }
                    .glassProminentButton()
            default:
                Button { m.sheet = .auth(.signup) } label: { Text("Create free account").frame(maxWidth: .infinity) }
                    .glassProminentButton()
            }
        }
        .controlSize(.regular)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .disabled(m.uid == nil)
    }

    // MARK: - Shortcuts

    private var quickActions: some View {
        HStack(spacing: 10) {
            // adding an expense is the card's big button above, so it isn't repeated here
            if m.profile.on(.work) { QuickAction(symbol: "clock.fill", tint: Tint.orange, label: "Log shift") { m.sheet = .shift(nil, nil) } }
            if m.flat != nil && m.profile.on(.list) { QuickAction(symbol: "cart.fill", tint: Tint.pink, label: "List", badge: m.openItems) { m.sheet = .list } }
            if !m.allExpenses.isEmpty { QuickAction(symbol: "chart.line.uptrend.xyaxis", tint: Tint.blue, label: "My spending") { m.sheet = .myAnalytics } }
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

    // MARK: - Notifications

    /// Asked once, here rather than from a switch deep in Settings — and only
    /// once there is someone whose expenses you would want to hear about.
    private var askPush: Bool {
        guard canAsk, !pushAsked, Push.shared.wanted else { return false }
        let circles = Set(m.circles.map(\.id))
        return !m.flats.isEmpty || m.allExpenses.contains { circles.contains($0.flatId) }
    }

    private var pushCard: some View {
        HeimatCard(radius: 22, padding: 14) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    SettingIcon(symbol: "bell.fill", color: .red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Know when someone adds a bill").font(.system(size: 15, weight: .semibold))
                        Text("Get a notification when someone adds an expense with you, pays you back, or a bill or chore is due.")
                            .font(.system(size: 12.5)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                HStack(spacing: 10) {
                    Button {
                        Haptic.tap()
                        Task {
                            await Push.shared.enable()
                            pushAsked = true
                            canAsk = false
                        }
                    } label: {
                        Text("Turn on").frame(maxWidth: .infinity)
                    }
                    .glassProminentButton()
                    Button { pushAsked = true } label: {
                        Text("Not now").frame(maxWidth: .infinity)
                    }
                    .glassButton()
                }
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 12)
            }
        }
    }

    /// A newer build is out (see AppModel.checkUpdate): one tap to TestFlight. It stays
    /// until this phone runs that build.
    private func updateCard(_ u: AppUpdate) -> some View {
        HeimatCard(radius: 22, padding: 14) {
            HStack(spacing: 12) {
                SettingIcon(symbol: "arrow.down.circle.fill", color: .blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text("New update available").font(.system(size: 15, weight: .semibold))
                    Text("Build \(u.build) is ready in TestFlight.")
                        .font(.system(size: 12.5)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Haptic.tap()
                    AppModel.openUpdate(u.url)
                } label: {
                    Text("Update").font(.system(size: 15, weight: .semibold))
                }
                .glassProminentButton()
                .controlSize(.small)
            }
        }
        .accessibilityElement(children: .contain)
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

    /// Activity: your five newest expenses wherever they are (only the ones you are on,
    /// each with the group it is in), or — one tap — the five newest things anyone did in
    /// any of your groups. Nothing here notifies anyone; See all opens the whole of it.
    private var recent: some View {
        let mine = m.myRecent(5)
        let all = Array(m.visibleActivity.prefix(5))
        let places = m.flats.count + (m.circles.isEmpty ? 0 : 1)
        return VStack(spacing: 0) {
            SectionLabel(text: "Activity") {
                Button("See all") { Haptic.tap(); m.sheet = .activity }
                    .font(.system(size: 13.5, weight: .semibold))
            }
            .padding(.bottom, 8)

            Picker("Show", selection: $feed) {
                Text("Your expenses").tag(Feed.mine)
                Text("Everything").tag(Feed.everything)
            }
            .pickerStyle(.segmented)
            .padding(.bottom, 10)

            HeimatCard(radius: 24, padding: 0) {
                switch feed {
                case .mine:
                    if mine.isEmpty {
                        empty("No shared expenses yet. Add the first one — rent, groceries, the internet bill — and Splitlife splits it.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(mine.enumerated()), id: \.element.id) { i, e in
                                Button { m.open(e) } label: {
                                    ExpenseRowView(e: e, showsPlace: places > 1).padding(.horizontal, 14).padding(.vertical, 11)
                                }
                                .buttonStyle(PressStyle())
                                if i < mine.count - 1 { Divider().padding(.leading, 64) }
                            }
                        }
                    }
                case .everything:
                    if all.isEmpty {
                        empty("Nothing has happened in your groups yet. Expenses, payments, the shopping list, bills and chores all show up here.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(all.enumerated()), id: \.element.id) { i, a in
                                ActivityRowView(a: a, showsPlace: places > 1)
                                if i < all.count - 1 { Divider().padding(.leading, 56) }
                            }
                        }
                    }
                }
            }
            .animation(.smooth, value: feed)
        }
        // what happened since you last looked: fetched when Everything is showing, never pushed
        .task(id: feed) { if feed == .everything { await m.loadActivity() } }
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14)).foregroundStyle(.secondary)
            .padding(18)
    }
}
