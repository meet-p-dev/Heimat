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
                    await Push.shared.refresh()
                    model.publishWidgetData()
                }
                .onChange(of: phase) { _, new in
                    // pick up anything Siri or a widget wrote while we were away
                    if new == .active { model.reloadLocal() }
                    // and leave the widgets something current to draw
                    if new == .background || new == .inactive {
                        model.publishWidgetData()
                        CloudBackup.shared.back(up: model)
                    }
                }
                .onOpenURL { url in
                    guard url.scheme == "heimat" else { return }
                    if url.host == "add-expense" { model.startAddExpense() }
                }
        }
    }
}

// MARK: - Routing

enum AppTab: Hashable, CaseIterable, Identifiable {
    case home, flat, work
    var id: Self { self }
    var title: String {
        switch self { case .home: "Home"; case .flat: "Flat"; case .work: "Work" }
    }
    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .flat: "person.2.fill"
        case .work: "clock.fill"
        }
    }
    var index: Int { AppTab.allCases.firstIndex(of: self) ?? 0 }
}
enum AuthMode: String, Hashable { case signup, signin, forgot, password, email }
enum FlatMode: Hashable { case create, join }
struct ExpensePrefill: Hashable { var desc: String; var category: String }

/// Every sheet the app presents. Sheets, toolbars and the tab bar are the
/// system's own, so iOS draws them in Liquid Glass.
enum SheetRoute: Identifiable, Hashable {
    case settings, profile, editProfile, invite, categories, list, analytics
    case auth(AuthMode)
    case flat(FlatMode)
    case expense(Expense?, ExpensePrefill?)
    case expenseDetail(Expense)
    case shift(Shift?, String?)
    case settle(Calc.Suggestion?)
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
        case .auth(let mode): AuthView(start: mode)
        case .flat(let mode): CreateJoinForm(mode: mode)
        case .expense(let e, let prefill): ExpenseForm(editing: e, prefill: prefill)
        case .expenseDetail(let e): ExpenseDetailView(expense: e)
        case .shift(let s, let date): ShiftForm(editing: s, day: date)
        case .settle(let s): SettleForm(initial: s)
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

/// The four sections. The stock `TabView` cuts from one tab to the next; this
/// one is a paging scroll view, so a sideways drag carries the page with your
/// thumb and can be caught mid-flight. The bar below reads that same scroll
/// offset, which is what lets its selection travel with the swipe.
struct MainTabs: View {
    @Environment(AppModel.self) private var m
    @State private var progress: Double = 0   // where the pager sits, in page widths
    @State private var scrolling = false

    var body: some View {
        ScrollViewReader { sp in
            GeometryReader { geo in
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 0) {
                        ForEach(AppTab.allCases) { tab in
                            page(tab)
                                .frame(width: geo.size.width, height: geo.size.height)
                                .id(tab)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollIndicators(.hidden)
                .onScrollGeometryChange(for: Double.self) { g in
                    g.contentOffset.x / max(g.containerSize.width, 1)
                } action: { _, p in
                    progress = p
                    let landed = AppTab.allCases[min(max(Int(p.rounded()), 0), AppTab.allCases.count - 1)]
                    if landed != m.tab { Haptic.tap(); m.tab = landed }
                }
                .onScrollPhaseChange { _, phase in scrolling = phase != .idle }
            }
            // a tap on the bar, or `m.tab` set from a card, glides the pager over;
            // while a finger is on it the scroll view is in charge instead.
            .onChange(of: m.tab) { _, tab in
                guard !scrolling, abs(progress - Double(tab.index)) > 0.01 else { return }
                withAnimation(.snappy(duration: 0.44, extraBounce: 0.18)) { sp.scrollTo(tab, anchor: .center) }
            }
        }
        .background { HeimatBackground() }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GlassTabBar(selection: Binding { m.tab } set: { m.tab = $0 }, progress: progress, badge: m.openItems)
        }
    }

    @ViewBuilder private func page(_ tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView()
        case .flat: FlatView()
        case .work: WorkView()
        }
    }
}

/// The bottom bar: one piece of the system's Liquid Glass, with the selection
/// riding on the pager's offset. `progress` is fractional during a swipe, so
/// the pill and the icon tints cross over gradually instead of snapping.
struct GlassTabBar: View {
    @Binding var selection: AppTab
    var progress: Double
    var badge: Int

    private var tabs: [AppTab] { AppTab.allCases }

    /// How far the pill's two edges lag or lead each other mid-crossing.
    /// Both curves start at 0 and end at 1, so the pill always settles to an
    /// exact capsule; in between, the front edge is ahead of the back one.
    private static let bend = 1.7
    private func lead(_ t: Double) -> Double { 1 - pow(1 - t, Self.bend) }
    private func trail(_ t: Double) -> Double { pow(t, Self.bend) }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width / CGFloat(tabs.count)
            let p = min(max(progress, 0), Double(tabs.count - 1))

            // Where the crossing is: `i` is the tab being left, `f` how far
            // along we are towards the next one.
            let i = p.rounded(.down)
            let f = p - i

            // The leading edge runs ahead and the trailing edge lags, so the
            // pill pulls out of the tab it is leaving and gathers into the one
            // it is entering — the liquid part. Symmetric, so it reads the same
            // dragging either way.
            let left = w * (i + trail(f))
            let right = w * (i + lead(f)) + w
            let width = right - left
            // 0 at rest, ~0.35 at the midpoint of a crossing
            let stretch = width / w - 1

            HStack(spacing: 0) {
                ForEach(tabs) { tab in item(tab).frame(width: w) }
            }
            .background(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.accentColor.opacity(0.22 - stretch * 0.05))
                    .overlay {
                        // a brighter rim while stretched, so the leading edge
                        // catches the light the way a moving droplet would
                        Capsule(style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10 + stretch * 0.22), lineWidth: 0.8)
                    }
                    .frame(width: max(width - 12, 0))
                    // squashes as it lengthens, which is what sells it as volume
                    .padding(.vertical, 6 + stretch * 4)
                    .offset(x: left + 6)
            }
        }
        .frame(height: 60)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private func item(_ tab: AppTab) -> some View {
        // 0 when this tab fills the screen, 1 once the next one does
        let d = min(abs(progress - Double(tab.index)), 1)
        let on = d < 0.5
        return Button {
            if tab == selection { return }
            Haptic.tap()
            selection = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: tab.symbol)
                    .font(.system(size: 19, weight: .semibold))
                    .scaleEffect(1 + 0.1 * (1 - d))
                    .overlay(alignment: .topTrailing) {
                        if tab == .flat && badge > 0 {
                            Text(badge > 99 ? "99+" : "\(badge)")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(.red, in: Capsule())
                                .offset(x: 12, y: -8)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                Text(tab.title).font(.system(size: 10.5, weight: .semibold))
            }
            .foregroundStyle(Color.secondary.mix(with: .accentColor, by: 1 - d))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : [.isButton])
    }
}

/// Settings and profile, top right on every tab — one glass capsule, drawn by iOS.
struct AppToolbar: ViewModifier {
    @Environment(AppModel.self) private var m

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { m.sheet = .settings } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { m.sheet = .profile } label: {
                    AvatarView(name: m.profile.name, color: m.profile.avatar, seed: m.uid, size: 28)
                }
                .accessibilityLabel("Your profile")
            }
        }
    }
}
