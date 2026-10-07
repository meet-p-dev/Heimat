import SwiftUI

@main
struct HeimatApp: App {
    @State private var model = AppModel()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(model.prefs.theme.scheme)
                .task {
                    Push.shared.model = model
                    Push.shared.takeDelegate()
                    Router.shared.model = model
                    await model.start()
                    #if DEBUG
                    if AppModel.fixtureMode { return }
                    #endif
                    await Push.shared.refresh()
                    Push.shared.clearBadge()
                    model.publishWidgetData()
                }
                .onChange(of: phase) { _, new in
                    // pick up anything Siri or a widget wrote while we were away
                    if new == .active {
                        model.reloadLocal(); Push.shared.clearBadge()
                        // a build that came out while the app was in the background
                        Task { await model.checkUpdate() }
                    }
                    // and leave the widgets something current to draw
                    if new == .background || new == .inactive {
                        model.publishWidgetData()
                        CloudBackup.shared.back(up: model)
                    }
                }
                .onOpenURL { url in
                    switch DeepLink(url) {
                    case .addExpense: model.startAddExpense()
                    case .invite(let token): Task { await model.claimInvite(token) }
                    // a group's invite link: the join form, code filled in — you still tap Join
                    case .join(let code): model.joinPrefill = code; model.sheet = .flat(.join)
                    case nil: break
                    }
                }
        }
    }
}

// MARK: - Routing

enum AppTab: Hashable, CaseIterable, Identifiable {
    case home, flat, work
    /// "Add expense", the separate glass button at the end of the bar (iOS 27):
    /// it opens the form rather than being a page of its own
    case add
    var id: Self { self }
    var title: String {
        switch self { case .home: "Home"; case .flat: "Groups"; case .work: "Work"; case .add: "Add expense" }
    }
    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .flat: "person.3.fill"
        case .work: "clock.fill"
        case .add: "plus"
        }
    }
    /// the tabs this person sees: Work only with shifts, Groups unless everything in it is switched off
    static func shown(_ p: Profile) -> [AppTab] {
        allCases.filter {
            switch $0 {
            case .home: true
            case .flat: p.on(.groups) || p.on(.bills) || p.on(.chores) || p.on(.list)
            case .work: p.on(.work) || p.on(.limit)
            case .add: false
            }
        }
    }
}
enum AuthMode: String, Hashable { case signup, signin, forgot, password, email }
enum FlatMode: Hashable { case create, join, group }

/// Links that open the app: heimat://add-expense, heimat://invite/<token> (the email we
/// send), heimat://join/<code> (a group's invite page), and the same pages on the web
/// (…/invite.html?t=…, …/join.html?c=…) for when the system hands those to the app.
enum DeepLink: Equatable {
    case addExpense, invite(String), join(String)
    init?(_ url: URL) {
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let item = { (n: String) in q.first { $0.name == n }?.value?.trimmingCharacters(in: .whitespaces) ?? "" }
        let first = url.pathComponents.filter { $0 != "/" }.first ?? ""
        switch (url.scheme, url.host) {
        case ("heimat", "add-expense"): self = .addExpense
        case ("heimat", "invite") where !first.isEmpty: self = .invite(first)
        case ("heimat", "join") where !first.isEmpty: self = .join(first.uppercased())
        case ("https", _) where url.lastPathComponent == "invite.html" && !item("t").isEmpty: self = .invite(item("t"))
        case ("https", _) where url.lastPathComponent == "join.html" && !item("c").isEmpty: self = .join(item("c").uppercased())
        default: return nil
        }
    }
}
struct ExpensePrefill: Hashable {
    var desc = ""
    var category = "groceries"
    /// start as an expense outside any group, with these people
    var people: [PersonPick]? = nil
}

/// Every sheet the app presents. Sheets, toolbars and the tab bar are the
/// system's own, so iOS draws them in Liquid Glass.
enum SheetRoute: Identifiable, Hashable {
    case settings, profile, editProfile, invite, categories, list, analytics, myAnalytics, history
    case auth(AuthMode)
    case flat(FlatMode)
    case expense(Expense?, ExpensePrefill?)
    case expenseDetail(Expense)
    case shift(Shift?, String?)
    case settle(Calc.Suggestion?)
    case settlePerson(String)
    /// a bill to edit, or a new one in a group (nil: one of your own)
    case bill(Bill?, String?)
    /// a chore to edit, or a new one in a group
    case chore(Chore?, String)
    var id: String { String(describing: self) }
}

struct SheetHost: View {
    let route: SheetRoute
    var body: some View {
        switch route {
        case .settings: NavigationStack { SettingsView() }
        case .profile: NavigationStack { ProfileView() }
        case .editProfile: EditProfileForm()
        case .invite: InviteView()
        case .categories: CategoriesView()
        case .list: NavigationStack { ShoppingListView() }
        case .analytics: NavigationStack { AnalyticsView() }
        case .myAnalytics: NavigationStack { AnalyticsView(personal: true) }
        case .history: NavigationStack { HistoryView() }
        case .auth(let mode): AuthView(start: mode)
        case .flat(let mode): CreateJoinForm(mode: mode)
        case .expense(let e, let prefill): ExpenseForm(editing: e, prefill: prefill)
        case .expenseDetail(let e): ExpenseDetailView(expense: e)
        case .shift(let s, let date): ShiftForm(editing: s, day: date)
        case .settle(let s): SettleForm(initial: s)
        case .settlePerson(let p): PersonSettleForm(person: p)
        case .bill(let b, let flat): BillForm(editing: b, flatId: b?.flatId ?? flat)
        case .chore(let c, let flat): ChoreForm(editing: c, flatId: c?.flatId ?? flat)
        }
    }
}

// MARK: - Root

struct RootView: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        @Bindable var m = m
        Group {
            if m.profile.onboarded { MainTabs() } else { OnboardingView() }
        }
        .overlay(alignment: .top) {
            if let t = m.toast {
                ToastView(text: t).transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.smooth, value: m.toast)
        .sheet(item: $m.sheet) { SheetHost(route: $0) }
    }
}

/// The three sections, in the system's own tab bar. On iOS 26 and later iOS draws it
/// in Liquid Glass — the lens you can slide along it, the bar that shrinks while you
/// scroll down, and from iOS 27 the glass it has there and the Liquid Glass slider in
/// Settings — and on iOS 27 "Add expense" sits beside it as a glass button of its own.
/// Before iOS 26 it is the classic bar. A tab changes in place, as in Apple's own
/// apps: the pager Splitlife had before slid the whole page across and bounced.
struct MainTabs: View {
    @Environment(AppModel.self) private var m

    private var tabs: [AppTab] { AppTab.shown(m.profile) }
    /// Add expense belongs to splitting costs: only when groups are switched on
    private var adds: Bool { m.profile.on(.groups) }
    /// What the bar has picked. It follows `m.tab`, except that the + only opens
    /// the form: the bar goes straight back to the tab you were on.
    @State private var picked: AppTab = .home

    var body: some View {
        TabView(selection: $picked) {
            ForEach(tabs) { tab in
                Tab(tab.title, systemImage: tab.symbol, value: tab) { page(tab) }
                    .badge(tab == .flat ? m.openItems : 0)
            }
            // The + sits apart from the tabs, in its own glass circle: on iOS 27 as the
            // `.prominent` tab, made for this; on iOS 26 in the one place iOS 26 sets
            // apart, the search tab's. (`.prominent` needs the iOS 27 SDK — Xcode 27,
            // Swift 6.4 — and an older Xcode uses the iOS 26 way everywhere.) Its page
            // is the app's own background, should iOS show it for a moment.
            if adds {
                #if compiler(>=6.4)
                if #available(iOS 27.0, *) {
                    Tab(AppTab.add.title, systemImage: AppTab.add.symbol, value: AppTab.add, role: .prominent) { HeimatBackground() }
                } else if #available(iOS 26.0, *), !Compat.legacy {
                    Tab(AppTab.add.title, systemImage: AppTab.add.symbol, value: AppTab.add, role: .search) { HeimatBackground() }
                }
                #else
                if #available(iOS 26.0, *), !Compat.legacy {
                    Tab(AppTab.add.title, systemImage: AppTab.add.symbol, value: AppTab.add, role: .search) { HeimatBackground() }
                }
                #endif
            }
        }
        .modifier(ShrinkOnScroll())
        .onChange(of: picked) { was, now in
            guard now == .add else { if m.tab != now { m.tab = now }; return }
            picked = was
            m.startAddExpense()
        }
        .onChange(of: m.tab) { _, tab in if picked != tab { picked = tab } }
        // a part switched off in Settings: its tab goes, and you land on Home
        // (also on opening, should the app have been left on a tab that has gone since)
        .onChange(of: tabs) { _, now in
            if !now.contains(m.tab) { m.tab = .home }
        }
        .onAppear {
            if !tabs.contains(m.tab) { m.tab = .home }
            picked = m.tab
        }
    }

    @ViewBuilder private func page(_ tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView()
        case .flat: GroupsView()
        case .work: WorkView()
        case .add: EmptyView()
        }
    }
}

/// iOS 26 and later: the bar shrinks to a small capsule while you scroll down a
/// page and comes back when you scroll up, so more of the page shows.
private struct ShrinkOnScroll: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !Compat.legacy {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}
