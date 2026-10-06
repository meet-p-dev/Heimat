import SwiftUI

/// First run: welcome → about you → your life (two questions) → keep it safe. Someone
/// who signs in from the welcome screen skips the account step — they already have an account.
struct OnboardingView: View {
    @Environment(AppModel.self) private var m
    @State private var step = 0
    @State private var draft = Profile()
    @State private var share: Set<String> = []
    @State private var doing: Set<String> = ["study"]
    @State private var rate = ""
    @State private var fetching = false
    @State private var sheet: SheetRoute?

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
    }

    private var welcome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "house.and.flag.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 76, height: 76)
                    .glassSurface(in: .rect(cornerRadius: 24))
                    .padding(.top, 24)
                Text("Splitlife").font(.system(size: 46, weight: .bold, design: .rounded))
                Text("Bills, chores and money, shared — for life abroad.").font(.title3).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 18) {
                    feature("person.2.fill", .green, "Split with anyone", "Flatmates, a partner, friends — Splitlife keeps score of who owes whom, live on every phone.")
                    feature("doc.text.fill", .blue, "Bills and chores, on time", "Rent day, the cleaning rota, the contract to cancel — reminded, then ticked.")
                    feature("clock.fill", .orange, "Shifts and your work limit", "Log shifts, see your pay and stay under a student visa's hours.")
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { Haptic.tap(); step = 1 } label: { Text("Get started").frame(maxWidth: .infinity) }
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

    private var aboutYou: some View {
        let home = Countries.home.first { $0.name == draft.homeCountry } ?? Countries.home[0]
        let host = Countries.host.first { $0.name == draft.hostCountry } ?? Countries.host[0]
        return Form {
            Section { TextField("First name", text: $draft.name).textContentType(.givenName) } header: { Text("Your name") }
            Section {
                Picker("Home country", selection: $draft.homeCountry) {
                    ForEach(Countries.home) { Text("\($0.flag) \($0.name) · \($0.cur)").tag($0.name) }
                }
                Picker("Studying in", selection: $draft.hostCountry) {
                    ForEach(Countries.host) { Text("\($0.flag) \($0.name) · \($0.cur)").tag($0.name) }
                }
            } footer: { Text("Every amount is shown in \(host.cur), with \(home.cur) next to it.") }
            if home.cur != host.cur {
                Section {
                    HStack {
                        TextField(fetching ? "Fetching…" : "e.g. 90,5", text: $rate).keyboardType(.decimalPad)
                        AsyncButton(action: { await live(host.cur, home.cur) }) { Label("Live", systemImage: "arrow.clockwise") }
                            .glassButton()
                    }
                } header: { Text("1 \(host.cur) = ? \(home.cur)") } footer: {
                    Text("A reference rate that updates itself once a day. You can change it in Settings.")
                }
            }
        }
        .navigationTitle("About you")
        .toolbar {
            if m.isAnon { ToolbarItem(placement: .cancellationAction) { Button { step = 0 } label: { Image(systemName: "chevron.left") } } }
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
        .task(id: "\(home.cur)\(host.cur)") { if home.cur != host.cur { await live(host.cur, home.cur) } }
    }

    /// Two questions; the app shows only the parts that fit (Settings → Your Splitlife changes it later).
    private var yourLife: some View {
        Form {
            Section {
                LifeChoices(options: Life.Share.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: $share)
            } header: { Text("Who do you share costs with?") } footer: { Text("Pick all that fit — or none if you live on your own.") }
            Section {
                LifeChoices(options: Life.Doing.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: $doing)
            } header: { Text("What do you do?") } footer: { Text("Splitlife shows only what you need. You can change it any time in Settings.") }
        }
        .navigationTitle("Your life")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button { step = 1 } label: { Image(systemName: "chevron.left") } } }
        .safeAreaInset(edge: .bottom) {
            Button {
                Haptic.tap()
                if m.isAnon { step = 3 } else { finish(signup: false) }
            } label: { Text(m.isAnon ? "Continue" : "Start using Splitlife").frame(maxWidth: .infinity) }
            .glassProminentButton().controlSize(.large)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
    }

    private var account: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 32, weight: .semibold)).foregroundStyle(.tint)
                    .frame(width: 70, height: 70)
                    .glassSurface(in: .rect(cornerRadius: 22))
                    .padding(.top, 24)
                Text("Keep your data safe").font(.largeTitle.bold())
                Text("Create a free account and your flat, balances and history come back on any phone you sign in on.")
                    .font(.body).foregroundStyle(.secondary)
                feature("icloud.fill", .blue, "Back up your place in the flat", "Change phone or reinstall without starting over.")
                feature("iphone.gen3", .indigo, "Use it on more than one device", "Sign in with the same email everywhere.")
            }
            .padding(.horizontal, 24)
        }
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button { step = 2 } label: { Image(systemName: "chevron.left") } } }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { finish(signup: true) } label: { Text("Create account").frame(maxWidth: .infinity) }
                    .glassProminentButton()
                Button { finish(signup: false) } label: { Text("Continue as guest").frame(maxWidth: .infinity) }
                    .glassButton()
                Text("You can create an account any time from Settings.").font(.caption).foregroundStyle(.secondary)
            }
            .controlSize(.large)
            .padding(.horizontal, 24).padding(.bottom, 8)
        }
    }

    private func live(_ host: String, _ home: String) async {
        fetching = true
        if let r = await Rates.fetch(host: host, home: home) { rate = Fmt.input(r) }
        fetching = false
    }

    private func finish(signup: Bool) {
        let home = Countries.home.first { $0.name == draft.homeCountry } ?? Countries.home[0]
        let host = Countries.host.first { $0.name == draft.hostCountry } ?? Countries.host[0]
        var p = draft
        p.name = p.name.trimmingCharacters(in: .whitespaces)
        p.homeCur = home.cur; p.homeIso = home.iso; p.hostCur = host.cur; p.hostIso = host.iso
        p.rate = home.cur == host.cur ? 1 : max(Fmt.parse(rate), 0)
        p.rateAt = home.cur == host.cur || Fmt.parse(rate) == 0 ? nil : Fmt.today()
        p.share = Life.Share.allCases.map(\.rawValue).filter(share.contains)
        p.doing = Life.Doing.allCases.map(\.rawValue).filter(doing.contains)
        p.onboarded = true
        m.saveProfile(p)
        if signup { m.sheet = .auth(.signup) }
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
