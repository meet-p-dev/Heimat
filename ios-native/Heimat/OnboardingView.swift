import SwiftUI

/// First run: welcome → about you → your life (two questions) → keep it safe. Someone
/// who signs in from the welcome screen skips the account step — they already have an account.
/// Everything that can be guessed is filled in (countries from the phone, today's rate), so
/// most people only confirm; an invite link that opened the app waits until setup is done.
struct OnboardingView: View {
    @Environment(AppModel.self) private var m
    @State private var step = 0
    @State private var draft = Profile()
    @State private var share: Set<String> = []
    @State private var doing: Set<String> = ["study"]
    @State private var rate = ""
    @State private var fetching = false
    @State private var rateFailed = false
    @State private var editRate = false
    @State private var guessed = false
    @State private var sheet: SheetRoute?
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case 0: welcome
                case 1: aboutYou
                case 2: yourLife
                default: account
                }
            }
            .animation(.smooth, value: step)
        }
        .sheet(item: $sheet) { SheetHost(route: $0) }
        .onChange(of: m.isAnon) { _, anon in if !anon && step == 0 { step = 1 } }
        .onChange(of: m.accountName) { _, n in if let n, draft.name.isEmpty { draft.name = n } }
        .onAppear(perform: guessCountries)
        #if DEBUG
        // demo mode: -HeimatStep 1|2|3 opens that step, with a made-up name
        .onAppear {
            let a = ProcessInfo.processInfo.arguments
            guard AppModel.fixtureMode, let i = a.firstIndex(of: "-HeimatStep"), i + 1 < a.count, let n = Int(a[i + 1]) else { return }
            draft.name = "Ana"; share = ["flatmates", "friends"]; doing = ["study", "shifts"]; step = n
        }
        #endif
    }

    private var invited: Bool { m.pendingLink != nil }

    // MARK: Welcome

    private var welcome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                AppMark(size: 76).padding(.top, 24)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Splitlife").font(.system(size: 46, weight: .bold, design: .rounded))
                    Text("Split life, not friendships.").font(.title3.weight(.semibold))
                    Text("The free money app for life abroad.").font(.body).foregroundStyle(.secondary)
                }
                if invited {
                    HStack(alignment: .top, spacing: 12) {
                        SettingIcon(symbol: "envelope.open.fill", color: .green)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("You've been invited").font(.headline)
                            Text("Set up takes about a minute — then you join the group straight away.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(14)
                    .glassSurface(in: .rect(cornerRadius: 20))
                }
                VStack(alignment: .leading, spacing: 18) {
                    feature("globe", .blue, "Every amount, twice", "In your local currency and your home currency, at today's rate.")
                    feature("person.3.fill", .green, "Family, friends, WG mates", "Groups, bills and chores — live on everyone's phone.")
                    feature("clock.fill", .orange, "Your job, your money", "Log shifts, see your pay, an estimate of the tax and your work limit.")
                    feature("gift.fill", .pink, "Free, no limits", "No ads, no tracking, no premium. As many expenses as you like.")
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 24)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { Haptic.tap(); step = 1 } label: { Text(invited ? "Set up and join" : "Get started").frame(maxWidth: .infinity) }
                    .glassProminentButton()
                Button { sheet = .auth(.signin) } label: { Text("I already have an account").frame(maxWidth: .infinity) }
                    .glassButton()
                Text("By continuing you agree to the [Terms](\(Secrets.publicURL)legal/terms.html) and [Privacy policy](\(Secrets.publicURL)legal/privacy.html).")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.top, 4)
            }
            .controlSize(.large)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
    }

    private func feature(_ symbol: String, _ color: Color, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            SettingIcon(symbol: symbol, color: color)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(body).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: About you

    private var home: Country { Countries.home.first { $0.name == draft.homeCountry } ?? Countries.home[0] }
    private var host: Country { Countries.host.first { $0.name == draft.hostCountry } ?? Countries.host[0] }

    private var aboutYou: some View {
        Form {
            Section {
                TextField("First name", text: $draft.name)
                    .textContentType(.givenName).submitLabel(.next).focused($nameFocused)
                    .onSubmit { if !draft.name.trimmingCharacters(in: .whitespaces).isEmpty { step = 2 } }
            } header: { Text("What should we call you?") } footer: { Text("Your groups see this name.") }
            Section {
                Picker("Where you live now", selection: $draft.hostCountry) {
                    ForEach(Countries.host) { Text("\($0.flag) \($0.name)").tag($0.name) }
                }
                Picker("Where you're from", selection: $draft.homeCountry) {
                    ForEach(Countries.home) { Text("\($0.flag) \($0.name)").tag($0.name) }
                }
            } footer: {
                Text(home.cur == host.cur ? "Amounts are shown in \(host.cur)." : "Amounts are shown in \(host.cur), with \(home.cur) next to them.")
            }
            if home.cur != host.cur { rateSection }
        }
        .navigationTitle("About you")
        .toolbar {
            if m.isAnon { ToolbarItem(placement: .cancellationAction) { Button { step = 0 } label: { Image(systemName: "chevron.left") } } }
            ToolbarItem(placement: .principal) { StepDots(at: 1, of: m.isAnon ? 3 : 2) }
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Haptic.tap()
                step = 2
            } label: { Text("Continue").frame(maxWidth: .infinity) }
            .glassProminentButton().controlSize(.large)
            .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
        .onAppear { if draft.name.isEmpty { nameFocused = true } }
        .task(id: "\(home.cur)\(host.cur)") { if home.cur != host.cur { await live() } }
    }

    /// Today's rate as a finished line; the field only when it's being changed or couldn't load.
    @ViewBuilder private var rateSection: some View {
        Section {
            if fetching && rate.isEmpty {
                HStack { Text("Getting today's rate…").foregroundStyle(.secondary); Spacer(); ProgressView() }
            } else if !rate.isEmpty && !editRate && !rateFailed {
                HStack {
                    Text("1 \(host.cur) = \(Fmt.input((Fmt.parse(rate) * 100).rounded() / 100)) \(home.cur)").monospacedDigit()
                    Spacer()
                    Button("Edit") { editRate = true }
                }
            } else {
                HStack {
                    TextField("e.g. 90,5", text: $rate).keyboardType(.decimalPad)
                    AsyncButton(action: { await live() }) { Label("Live", systemImage: "arrow.clockwise") }
                        .glassButton()
                }
            }
        } header: { Text("Exchange rate") } footer: {
            Text(rateFailed
                 ? "Couldn't load today's rate. Type it in — or leave it empty and Splitlife fills it in once you're online."
                 : "Today's reference rate. It updates itself once a day; change it any time in Settings.")
        }
    }

    // MARK: Your life

    /// Two questions; the app shows only the parts that fit (Settings → Your Splitlife changes it later).
    private var yourLife: some View {
        let parts = Life.Part.allCases.filter { Life.suggested($0, share: Array(share), doing: Array(doing)) }
        return Form {
            Section {
                LifeChoices(options: Life.Share.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: $share)
            } header: { Text("Who do you share costs with?") } footer: { Text("Pick all that fit — or none if you live on your own.") }
            Section {
                LifeChoices(options: Life.Doing.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: $doing)
            } header: { Text("What do you do?") }
            Section {
                ForEach(parts) { p in
                    Label { VStack(alignment: .leading, spacing: 1) { Text(p.label); Text(p.sub).font(.caption).foregroundStyle(.secondary) } }
                        icon: { Image(systemName: p.symbol).foregroundStyle(.tint) }
                }
            } header: { Text("Your Splitlife") } footer: {
                Text("Home and your own spending are always there. Switch any part on or off later in Settings → Your Splitlife.")
            }
        }
        .animation(.smooth, value: parts)
        .navigationTitle("Your life")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button { step = 1 } label: { Image(systemName: "chevron.left") } }
            ToolbarItem(placement: .principal) { StepDots(at: 2, of: m.isAnon ? 3 : 2) }
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Haptic.tap()
                if m.isAnon { step = 3 } else { finish(signup: false) }
            } label: { Text(m.isAnon ? "Continue" : "Start using Splitlife").frame(maxWidth: .infinity) }
            .glassProminentButton().controlSize(.large)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
    }

    // MARK: Account

    private var account: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 32, weight: .semibold)).foregroundStyle(.tint)
                    .frame(width: 70, height: 70)
                    .glassSurface(in: .rect(cornerRadius: 22))
                    .padding(.top, 24)
                Text("Keep your data safe").font(.largeTitle.bold())
                Text("A free account keeps your groups, balances and history — on any phone you sign in on.")
                    .font(.body).foregroundStyle(.secondary)
                feature("icloud.fill", .blue, "Never start over", "Change phone or reinstall, and everything is still there.")
                feature("iphone.gen3", .indigo, "On every device", "iPhone, Android or the web — the same email everywhere.")
                feature("person.2.fill", .green, "Friends can find you", "People can add you to an expense by your email.")
            }
            .padding(.horizontal, 24)
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button { step = 2 } label: { Image(systemName: "chevron.left") } }
            ToolbarItem(placement: .principal) { StepDots(at: 3, of: 3) }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { finish(signup: true) } label: { Text("Create free account").frame(maxWidth: .infinity) }
                    .glassProminentButton()
                Button { finish(signup: false) } label: { Text("Not now — try it first").frame(maxWidth: .infinity) }
                    .glassButton()
                Text("Without an account, your data lives only on this phone. You can create one any time in Settings.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .controlSize(.large)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
    }

    // MARK: Logic

    /// Fill in what the phone already knows, once, before anyone has picked anything.
    private func guessCountries() {
        guard !guessed else { return }
        guessed = true
        let g = Countries.guess()
        if let h = g.host { draft.hostCountry = h.name }
        if let h = g.home { draft.homeCountry = h.name }
        if draft.name.isEmpty, let n = m.accountName { draft.name = n }
    }

    private func live() async {
        fetching = true
        rateFailed = false
        if let r = await Rates.fetch(host: host.cur, home: home.cur) { rate = Fmt.input(r); editRate = false }
        else if rate.isEmpty { rateFailed = true }
        fetching = false
    }

    private func finish(signup: Bool) {
        var p = draft
        p.name = p.name.trimmingCharacters(in: .whitespaces)
        p.homeCountry = home.name; p.hostCountry = host.name
        p.homeCur = home.cur; p.homeIso = home.iso; p.hostCur = host.cur; p.hostIso = host.iso
        p.rate = home.cur == host.cur ? 1 : max(Fmt.parse(rate), 0)
        p.rateAt = home.cur == host.cur || Fmt.parse(rate) == 0 ? nil : Fmt.today()
        p.share = Life.Share.allCases.map(\.rawValue).filter(share.contains)
        p.doing = Life.Doing.allCases.map(\.rawValue).filter(doing.contains)
        p.onboarded = true
        m.saveProfile(p)
        // an invite link that opened the app waits for the account sheet to close (RootView)
        if signup { m.sheet = .auth(.signup) } else { m.resumePendingLink() }
    }
}

/// Where you are in setup: a dot per step, the current one long.
struct StepDots: View {
    let at: Int, of: Int
    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...of, id: \.self) { i in
                Capsule().fill(i <= at ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
                    .frame(width: i == at ? 22 : 7, height: 7)
            }
        }
        .animation(.smooth, value: at)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(at) of \(of)")
    }
}

/// The Splitlife "S" from the app icon — two arcs — on a glass tile.
struct AppMark: View {
    var size: CGFloat = 76
    var body: some View {
        Canvas { ctx, s in
            let k = s.width / 64, w = 5.76 * k
            var top = Path(), bottom = Path()
            top.addArc(center: CGPoint(x: 32 * k, y: 21.12 * k), radius: 9.6 * k, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: true)
            bottom.addArc(center: CGPoint(x: 32 * k, y: 42.88 * k), radius: 9.6 * k, startAngle: .degrees(270), endAngle: .degrees(180), clockwise: false)
            ctx.stroke(top, with: .color(.accentColor), lineWidth: w)
            ctx.stroke(bottom, with: .color(.accentColor.opacity(0.45)), lineWidth: w)
        }
        .frame(width: size * 0.62, height: size * 0.62)
        .frame(width: size, height: size)
        .glassSurface(in: .rect(cornerRadius: size * 0.3))
        .accessibilityHidden(true)
    }
}

/// Tick-boxes for one of the questions, in a Form section: a row each.
struct LifeChoices: View {
    let options: [(id: String, label: String, symbol: String)]
    @Binding var chosen: Set<String>

    var body: some View {
        ForEach(options, id: \.id) { o in
            Button {
                Haptic.tap()
                if chosen.contains(o.id) { chosen.remove(o.id) } else { chosen.insert(o.id) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: o.symbol).foregroundStyle(.tint).frame(width: 24)
                    Text(o.label).foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: chosen.contains(o.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3).foregroundStyle(chosen.contains(o.id) ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(chosen.contains(o.id) ? .isSelected : [])
        }
    }
}
