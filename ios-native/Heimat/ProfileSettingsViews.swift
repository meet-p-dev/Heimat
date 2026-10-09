import SwiftUI
import UniformTypeIdentifiers

// MARK: - Profile

/// Who you are and your account: the avatar button top right, or the card at the top
/// of Settings. How the app behaves lives in Settings; nothing is in both.
struct ProfileView: View {
    @Environment(AppModel.self) private var m
    /// pushed from Settings: no close button of its own (the sheet has one)
    var pushed = false
    @State private var sheet: SheetRoute?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false

    var body: some View {
        let p = m.profile
        let home = Countries.home.first { $0.name == p.homeCountry }
        let host = Countries.host.first { $0.name == p.hostCountry }
        List {
            Section { header(p, home: home, host: host) }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))

            if m.isAnon { guestCard }
            if let pending = m.pendingEmail {
                Section { Label("Confirm \(pending) — open the link we sent to finish.", systemImage: "envelope.badge.fill").font(.subheadline) }
            }

            Section { stats }

            Section {
                Button { sheet = .editProfile } label: { info("Name", p.name.isEmpty ? "Add your name" : p.name) }
                Button { sheet = .editProfile } label: { info("Home country", "\(home?.flag ?? "🌍") \(p.homeCountry)") }
                Button { sheet = .editProfile } label: { info("Living in", "\(host?.flag ?? "🌍") \(p.hostCountry)") }
                Button { sheet = .editProfile } label: {
                    info("Currency", p.homeCur == p.hostCur ? p.hostCur : "\(p.hostCur) · home \(p.homeCur)")
                }
            } header: { Text("Personal info") } footer: { Text("People in your groups see your name and colour.") }
            .tint(.primary)

            Section {
                ForEach(m.flats) { f in
                    Button { m.switchFlat(f.id); m.tab = .flat; m.groupsPath = [.group(f.id)]; m.sheet = nil } label: { groupRow(f) }
                }
                Button { sheet = .flat(.group) } label: { Label("New group", systemImage: "plus.circle.fill") }
                Button { sheet = .flat(.join) } label: { Label("Join with a code", systemImage: "key.fill") }
            } header: { Text("Your groups") }

            if !m.isAnon {
                Section {
                    Button { sheet = .auth(.email) } label: { info("Email", m.email ?? "", chevron: true) }
                    Button { sheet = .auth(.password) } label: { info("Password", "Change", chevron: true) }
                } header: { Text("Sign-in & security") } footer: {
                    if let pending = m.pendingEmail { Text("Waiting for you to confirm \(pending).") }
                }
                .tint(.primary)

                Section {
                    Button(role: .destructive) { confirmSignOut = true } label: { Text("Sign out").frame(maxWidth: .infinity) }
                }
            }

            Section {
                Button(role: .destructive) { confirmDelete = true } label: { Text("Delete account").frame(maxWidth: .infinity) }
            } footer: {
                Text("Leaves every group and removes everything stored about you on the server. Shared expenses stay with the group, without your name. This cannot be undone.")
            }
        }
        .navigationTitle("Profile")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !pushed {
                ToolbarItem(placement: .cancellationAction) { Button { m.sheet = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Close") }
            }
            ToolbarItem(placement: .primaryAction) { Button("Edit") { sheet = .editProfile } }
        }
        .sheet(item: $sheet) { SheetHost(route: $0) }
        .confirmationDialog("Sign out? Your groups stay safe — sign back in any time with your email.", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await m.signOut(); m.sheet = nil } }
        }
        .confirmationDialog("Delete your Splitlife account? You leave every group and everything stored about you on the server is removed. This cannot be undone.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { Task { if let e = await m.deleteAccount() { m.show(e) } } }
        } message: {
            // money still open somewhere: say where, and how it can come back
            let open = (m.flats + m.circles).compactMap { f -> String? in
                let b = m.myBalance(in: f.id)
                guard b.minor != 0 else { return nil }
                let amt = Fmt.money(Money.toMajor(abs(b.minor), b.currency), b.currency)
                let place = f.isDirect ? "with friends" : "in \(f.name)"
                return b.minor > 0 ? "You're still owed \(amt) \(place)." : "You still owe \(amt) \(place)."
            }
            if !open.isEmpty {
                Text(open.joined(separator: "\n") + "\n\nYour expenses stay with the group. To get them back after deleting, someone in it has to invite you back.")
            }
        }
    }

    /// avatar (tap to change it), name, email, where you're from and where you live
    private func header(_ p: Profile, home: Country?, host: Country?) -> some View {
        VStack(spacing: 6) {
            Button { sheet = .editProfile } label: {
                AvatarView(name: p.name, color: p.avatar, seed: m.uid, size: 96)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.primary)
                            .frame(width: 30, height: 30)
                            .background(.regularMaterial, in: Circle())
                            .overlay(Circle().strokeBorder(.background, lineWidth: 2.5))
                    }
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel("Edit profile")
            .padding(.bottom, 6)
            Text(p.name.isEmpty ? "You" : p.name).font(.title2.bold())
            if m.isAnon {
                Pill(text: "Guest · this phone only", color: .orange)
            } else if let email = m.email {
                Text(email).font(.subheadline).foregroundStyle(.secondary)
            }
            Text("\(home?.flag ?? "🌍") \(p.homeCountry)  →  \(host?.flag ?? "🌍") \(p.hostCountry)")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var guestCard: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keep your groups safe").font(.headline)
                    Text("As a guest, everything lives on this phone. A free account keeps your groups and balances on a new phone or after a reinstall.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            } icon: { SettingIcon(symbol: "exclamationmark.shield.fill", color: .orange) }
            HStack(spacing: 10) {
                Button { sheet = .auth(.signup) } label: { Text("Create account").frame(maxWidth: .infinity) }.glassProminentButton()
                Button { sheet = .auth(.signin) } label: { Text("Sign in").frame(maxWidth: .infinity) }.glassButton()
            }
            .controlSize(.large)
        }
    }

    /// three numbers side by side, the way a profile shows them
    private var stats: some View {
        HStack(spacing: 0) {
            stat("\(m.flats.count)", m.flats.count == 1 ? "Group" : "Groups")
            Divider().frame(height: 34)
            stat(m.fH(m.spentTotal), "Your share")
            if m.profile.on(.work) {
                Divider().frame(height: 34)
                stat(m.fH(m.earnedTotal), "Earned")
            }
        }
        .padding(.vertical, 4)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 17, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func info(_ label: String, _ value: String, chevron: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(.primary)
            Spacer(minLength: 12)
            Text(value).foregroundStyle(.secondary).lineLimit(1)
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
        }
        .contentShape(Rectangle())
    }

    /// a group: how many people, and where you stand in it
    private func groupRow(_ f: Flat) -> some View {
        let b = m.myBalance(in: f.id)
        let people = m.members(of: f.id).count
        let amt = Fmt.money(Money.toMajor(abs(b.minor), b.currency), b.currency)
        return HStack(spacing: 12) {
            SettingIcon(symbol: f.kind == "flat" ? "house.fill" : "person.3.fill", color: f.kind == "flat" ? .green : .blue)
            VStack(alignment: .leading, spacing: 1) {
                Text(f.name).foregroundStyle(Color.primary).lineLimit(1)
                Text("\(people) \(people == 1 ? "person" : "people")\(m.isSimplified(f.id) ? " · simplified" : "")")
                    .font(.caption).foregroundStyle(Color.secondary)
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                if b.minor == 0 {
                    Text("Settled").font(.subheadline).foregroundStyle(Color.secondary)
                } else {
                    Text(b.minor > 0 ? "you get" : "you owe").font(.caption).foregroundStyle(Color.secondary)
                    Text(amt).font(.subheadline.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(b.minor > 0 ? Color.green : Color.orange)
                }
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.secondary.opacity(0.6))
        }
        .contentShape(Rectangle())
    }
}

struct EditProfileForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var p = Profile()
    @State private var rate = ""

    var body: some View {
        let home = Countries.home.first { $0.name == p.homeCountry } ?? Countries.home[0]
        let host = Countries.host.first { $0.name == p.hostCountry } ?? Countries.host[0]
        let shown = p.avatar ?? AvatarColors.forSeed(m.uid ?? p.name)
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 14) {
                        AvatarView(name: p.name, color: shown, size: 84)
                        HStack(spacing: 10) {
                            ForEach(AvatarColors.all, id: \.self) { c in
                                Button { p.avatar = c } label: {
                                    Circle().fill(Color(hex: c).gradient).frame(width: 30, height: 30)
                                        .overlay { if shown == c { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Avatar colour")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
                Section {
                    TextField("Name", text: $p.name).textContentType(.givenName)
                } header: { Text("Name") } footer: { Text("Your flatmates see this name next to what you add.") }
                Section {
                    Picker("Home country", selection: $p.homeCountry) { ForEach(Countries.home) { Text("\($0.flag) \($0.name) · \($0.cur)").tag($0.name) } }
                    Picker("Studying in", selection: $p.hostCountry) { ForEach(Countries.host) { Text("\($0.flag) \($0.name) · \($0.cur)").tag($0.name) } }
                }
                if home.cur != host.cur {
                    Section("1 \(host.cur) = ? \(home.cur)") {
                        HStack {
                            TextField("Rate", text: $rate).keyboardType(.decimalPad)
                            AsyncButton(action: { if let r = await Rates.fetch(host: host.cur, home: home.cur) { rate = Fmt.input(r) } }) {
                                Label("Live", systemImage: "arrow.clockwise")
                            }
                            .glassButton()
                        }
                    }
                }
            }
            .navigationTitle("Edit profile")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var n = p
                        n.name = n.name.trimmingCharacters(in: .whitespaces)
                        n.homeCur = home.cur; n.homeIso = home.iso; n.hostCur = host.cur; n.hostIso = host.iso
                        let r = Fmt.parse(rate)
                        if home.cur == host.cur { n.rate = 1 } else if r > 0 && r != m.profile.rate { n.rate = r; n.rateAt = Fmt.today() }
                        m.saveProfile(n); m.show("Profile saved"); dismiss()
                    }
                    .disabled(p.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { p = m.profile; rate = Fmt.input(m.profile.rate) }
            .onChange(of: "\(home.cur)\(host.cur)") { _, _ in
                Task { if home.cur != host.cur, let r = await Rates.fetch(host: host.cur, home: home.cur) { rate = Fmt.input(r) } }
            }
        }
    }
}

// MARK: - Settings

/// How the app behaves. One screen of short rows, each showing what it's set to and
/// opening its own page — the way iOS's own Settings is laid out. Your account sits
/// at the top as a card that opens your profile.
struct SettingsView: View {
    @Environment(AppModel.self) private var m
    @State private var pushOn = false
    @State private var pushDenied = false
    @State private var cloudOn = CloudBackup.shared.enabled
    @State private var taxOpen = false

    var body: some View {
        @Bindable var m = m
        let p = m.profile
        Form {
            Section {
                NavigationLink { ProfileView(pushed: true) } label: { accountCard }
            }

            Section {
                NavigationLink { LifeSettingsView() } label: {
                    settingRow("slider.horizontal.3", .indigo, "Your Splitlife", sub: "Choose what the app shows")
                }
            }

            Section("Preferences") {
                Picker(selection: $m.prefs.theme) {
                    ForEach(ThemeMode.allCases) { Text($0.label).tag($0) }
                } label: { settingRow("circle.lefthalf.filled", .indigo, "Appearance") }
                NavigationLink { NotificationSettingsView() } label: {
                    valueRow("bell.fill", .red, "Notifications", pushDenied ? "Blocked" : pushOn ? "On" : "Off")
                }
                Toggle(isOn: $m.prefs.haptics) { settingRow("hand.tap.fill", .pink, "Haptic feedback") }
            }

            Section("Money & work") {
                NavigationLink { CurrencySettingsView() } label: {
                    valueRow("eurosign", .teal, "Currency", p.homeCur == p.hostCur ? p.hostCur : "\(p.hostCur) → \(p.homeCur)")
                }
                if p.on(.work) || p.on(.limit) {
                    NavigationLink { WorkLimitsView() } label: {
                        valueRow("timer", .orange, "Work limits", "\(m.prefs.weekCap) h · \(m.prefs.yearDays) days")
                    }
                }
                if p.on(.work) && p.hostIso == "de" {
                    Button { taxOpen = true } label: {
                        valueRow("building.columns.fill", .indigo, "Tax details", p.tax == nil ? "Not set" : "Set", chevron: true)
                    }
                }
            }
            .tint(.primary)

            Section {
                NavigationLink { BackupSettingsView() } label: {
                    valueRow("icloud.fill", .blue, "iCloud backup", cloudOn ? "On" : "Off")
                }
                NavigationLink { DataSettingsView() } label: {
                    settingRow("externaldrive.fill", .gray, "Export & import", sub: "Your data, shifts and timesheets")
                }
            } header: { Text("Your data") }

            Section {
                Link(destination: URL(string: Secrets.publicURL + "legal/privacy.html")!) { linkRow("hand.raised.fill", .blue, "Privacy policy") }
                Link(destination: URL(string: Secrets.publicURL + "legal/terms.html")!) { linkRow("doc.text.fill", .gray, "Terms of use") }
            } header: { Text("Legal") }
            .tint(.primary)

            Section {
                LabeledContent("Version", value: Self.version)
                if let uid = m.uid {
                    Button { UIPasteboard.general.string = uid; m.show("Account ID copied") } label: {
                        LabeledContent("Account ID", value: String(uid.prefix(8)) + "…")
                    }
                    .tint(.primary)
                }
            } header: { Text("About") } footer: {
                Text("Your profile and shifts stay on this phone. What you share in a group syncs only with the people in it.")
            }
        }
        .navigationTitle("Settings")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { m.sheet = nil } }
        }
        .sheet(isPresented: $taxOpen) { TaxSheet() }
        // coming back from a page: show what it is set to now
        .onAppear {
            cloudOn = CloudBackup.shared.enabled
            Task {
                pushDenied = await Push.shared.permission() == .denied
                pushOn = await NotificationSettingsView.isOn()
            }
        }
    }

    static var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        return b.map { "\(v) (\($0))" } ?? v
    }

    /// your avatar, name and email — opens your profile
    private var accountCard: some View {
        HStack(spacing: 14) {
            AvatarView(name: m.profile.name, color: m.profile.avatar, seed: m.uid, size: 58)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.profile.name.isEmpty ? "You" : m.profile.name).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                Text(m.isAnon ? "Guest — create an account to keep your groups" : "Profile, groups & sign-in")
                    .font(.subheadline).foregroundStyle(m.isAnon ? .orange : .secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

/// a coloured icon tile and a title (and a line under it)
private func settingRow(_ symbol: String, _ color: Color, _ title: String, sub: String? = nil) -> some View {
    Label {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).foregroundStyle(.primary)
            if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
        }
    } icon: { SettingIcon(symbol: symbol, color: color) }
}

/// a row that says what it is set to on the right, as iOS's Settings does
private func valueRow(_ symbol: String, _ color: Color, _ title: String, _ value: String, chevron: Bool = false) -> some View {
    Label {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer(minLength: 12)
            Text(value).foregroundStyle(.secondary).lineLimit(1)
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
        }
    } icon: { SettingIcon(symbol: symbol, color: color) }
}

/// a row that leaves the app (a web page)
private func linkRow(_ symbol: String, _ color: Color, _ title: String) -> some View {
    Label {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer()
            Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
    } icon: { SettingIcon(symbol: symbol, color: color) }
}

// MARK: Settings pages

struct NotificationSettingsView: View {
    @State private var pushOn = false
    @State private var pushDenied = false
    /// what the last test notification came back with, in words
    @State private var pushTest: String?

    /// On means: the user asked for it *and* iOS still allows it.
    static func isOn() async -> Bool {
        // `&&` takes its right side as an autoclosure, which cannot be awaited
        guard Push.shared.wanted else { return false }
        return await Push.shared.permission() == .authorized
    }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: Binding(get: { pushOn }, set: { on in
                    pushTest = nil
                    Task {
                        if on {
                            if let why = await Push.shared.enable() { pushDenied = why == "denied" }
                        } else {
                            Push.shared.disable()
                        }
                        pushOn = await Self.isOn()
                    }
                })) {
                    settingRow("bell.fill", .red, "Allow notifications")
                }
                .disabled(pushDenied)
            } footer: {
                Text(pushDenied
                     ? "Blocked in iOS Settings — turn Splitlife's notifications back on there."
                     : "When someone adds an expense with you, settles up, reminds you, or a new version is out.")
            }
            if pushDenied {
                Section {
                    Button("Open iOS Settings") {
                        if let u = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(u) }
                    }
                }
            }

            // the only way to tell "nothing has happened" from "nothing arrives"
            if pushOn {
                Section {
                    AsyncButton(action: { pushTest = await Push.shared.sendTest() }) {
                        settingRow("paperplane.fill", .blue, "Send a test notification")
                    }
                    .tint(.primary)
                } footer: {
                    if let pushTest { Text(pushTest).foregroundStyle(.primary) }
                    else { Text("Not getting any? Send one to each of your phones to check.") }
                }
            }
        }
        .navigationTitle("Notifications")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .task { pushOn = await Self.isOn(); pushDenied = await Push.shared.permission() == .denied }
    }
}

struct CurrencySettingsView: View {
    @Environment(AppModel.self) private var m
    @State private var sheet: SheetRoute?

    var body: some View {
        @Bindable var m = m
        let p = m.profile
        Form {
            Section {
                Button { sheet = .editProfile } label: { line("Where you live", "\(p.hostCountry) · \(p.hostCur)") }
                Button { sheet = .editProfile } label: { line("Home", "\(p.homeCountry) · \(p.homeCur)") }
            } footer: { Text("Splitlife counts in the currency where you live, and shows your home currency beside it.") }
            .tint(.primary)

            if p.homeCur != p.hostCur {
                Section {
                    LabeledContent {
                        Text("\(Fmt.rate(p.rate)) \(p.homeCur)").monospacedDigit()
                    } label: {
                        VStack(alignment: .leading) {
                            Text("1 \(p.hostCur) =")
                            Text(p.rateAt.map { "Updated \(Fmt.relDay($0).lowercased())" } ?? "Set by hand").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Toggle("Update every day", isOn: $m.prefs.autoRate)
                    AsyncButton(action: {
                        if let r = await m.refreshRate() { m.show("1 \(p.hostCur) = \(Fmt.num(r, 2)) \(p.homeCur)") } else { m.show("Couldn't reach the rate service") }
                    }) { Text("Update now") }
                } header: { Text("Exchange rate") } footer: { Text("Rates come from open.er-api.com and are for reference only.") }
            }
        }
        .navigationTitle("Currency")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $sheet) { SheetHost(route: $0) }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack { Text(label).foregroundStyle(.primary); Spacer(); Text(value).foregroundStyle(.secondary) }.contentShape(Rectangle())
    }
}

struct WorkLimitsView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    /// opened on its own (from the Work tab), not from Settings
    var standalone = false

    var body: some View {
        @Bindable var m = m
        Form {
            Section {
                Stepper(value: $m.prefs.weekCap, in: 1...60) {
                    LabeledContent("Hours a week", value: "\(m.prefs.weekCap) h")
                }
                Stepper(value: $m.prefs.yearDays, in: 10...365, step: 5) {
                    LabeledContent("Full days a year", value: "\(m.prefs.yearDays)")
                }
            } footer: {
                Text("Germany: about 120 full days (or 240 half days) a year, and 20 hours a week during term. Other countries differ — check with your international office.")
            }
            if m.prefs.weekCap != 20 || m.prefs.yearDays != 120 {
                Section { Button("Reset to Germany's limits") { m.prefs.weekCap = 20; m.prefs.yearDays = 120 } }
            }
        }
        .navigationTitle("Work limits")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if standalone { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct BackupSettingsView: View {
    @Environment(AppModel.self) private var m
    @State private var cloudOn = CloudBackup.shared.enabled
    @State private var lastBackup: Date?
    @State private var confirmRestore = false

    var body: some View {
        Form {
            Section {
                Toggle(isOn: Binding(get: { cloudOn }, set: { on in
                    CloudBackup.shared.enabled = on
                    cloudOn = on
                    if on { CloudBackup.shared.back(up: m) }
                    else { CloudBackup.shared.turnOff() }
                    lastBackup = CloudBackup.shared.lastBackup
                })) {
                    settingRow("icloud.fill", .blue, "Back up to iCloud")
                }
                .disabled(!CloudBackup.shared.available)
            } footer: {
                Text(CloudBackup.shared.available
                     ? "Your profile and shifts are copied to your own iCloud so a new phone can pick them up. Nothing goes to Splitlife's servers. Groups don't need it — they are saved with your account."
                     : "Sign in to iCloud on this phone to back up your profile and shifts.")
            }

            if cloudOn {
                Section {
                    Button {
                        CloudBackup.shared.back(up: m)
                        lastBackup = CloudBackup.shared.lastBackup
                        Haptic.success()
                        m.show("Backed up to iCloud")
                    } label: {
                        LabeledContent {
                            Text(lastBackup.map { "Last: \(Fmt.relDay(Fmt.ymd($0)).lowercased())" } ?? "Never").foregroundStyle(.secondary)
                        } label: { Text("Back up now").foregroundStyle(.tint) }
                    }
                    if CloudBackup.shared.peek() != nil {
                        Button("Restore from iCloud") { confirmRestore = true }
                    }
                }
            }
        }
        .navigationTitle("iCloud backup")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .task { lastBackup = CloudBackup.shared.lastBackup }
        .confirmationDialog("Restore from iCloud? The shifts on this phone are replaced by the backup.", isPresented: $confirmRestore, titleVisibility: .visible) {
            Button("Restore", role: .destructive) { _ = CloudBackup.shared.restore(into: m) }
        }
    }
}

struct DataSettingsView: View {
    @Environment(AppModel.self) private var m
    @State private var picking = false
    @State private var confirmClear = false
    @State private var jsonURL: URL?
    @State private var csvURL: URL?

    var body: some View {
        Form {
            Section {
                if let jsonURL {
                    ShareLink(item: jsonURL) { settingRow("square.and.arrow.up", .blue, "Export my data", sub: "Profile and shifts as a file") }
                }
                if let csvURL, !m.shifts.isEmpty {
                    ShareLink(item: csvURL) { settingRow("tablecells", .green, "Export shifts", sub: "A spreadsheet for timesheets or your tax return") }
                }
                Button { picking = true } label: { settingRow("square.and.arrow.down", .orange, "Import shifts", sub: "From a Splitlife export or a timesheet (CSV)") }
            } header: { Text("Export & import") }
            .tint(.primary)

            Section {
                Button(role: .destructive) { confirmClear = true } label: { Text("Clear shifts on this phone") }
            } footer: { Text("Removes the shifts logged on this phone. Your account, profile and groups aren't affected.") }
        }
        .navigationTitle("Export & import")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .task { jsonURL = m.exportJSON(); csvURL = m.exportCSV() }
        .modifier(ImportShifts(picking: $picking))
        .confirmationDialog("Clear the shifts stored on this phone? Your account, profile and groups aren't affected.", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear shifts", role: .destructive) { m.clearLocal() }
        }
    }
}

/// The three questions again, and every part of the app with its switch. A switch
/// flipped by hand stays that way; "Show what fits me" goes back to the answers.
struct LifeSettingsView: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        let p = m.profile
        Form {
            Section {
                LifeChoices(options: Life.Share.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: binding(\.share))
            } header: { Text("Who do you share costs with?") }
            Section {
                LifeChoices(options: Life.Doing.allCases.map { ($0.rawValue, $0.label, $0.symbol) }, chosen: binding(\.doing))
            } header: { Text("What do you do?") }
            Section {
                ForEach(Life.Part.allCases) { part in
                    Toggle(isOn: Binding(get: { m.profile.on(part) }, set: { v in
                        var q = m.profile
                        var o = q.parts ?? [:]
                        // the same as the answers suggest: no need to remember it
                        if v == Life.suggested(part, share: q.share, doing: q.doing) { o[part.rawValue] = nil } else { o[part.rawValue] = v }
                        q.parts = o.isEmpty ? nil : o
                        m.saveProfile(q)
                    })) {
                        Label { VStack(alignment: .leading, spacing: 1) { Text(part.label); Text(part.sub).font(.caption).foregroundStyle(.secondary) } }
                            icon: { SettingIcon(symbol: part.symbol, color: .indigo) }
                    }
                }
            } header: { Text("Show in the app") } footer: {
                Text("Hiding a part never deletes anything — switch it back on and it is all there.")
            }
            if p.parts != nil {
                Section {
                    Button("Show what fits me") { var q = m.profile; q.parts = nil; m.saveProfile(q) }
                }
            }
        }
        .navigationTitle("Your Splitlife")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// one question's answers as a set, saved on every change
    private func binding(_ key: WritableKeyPath<Profile, [String]?>) -> Binding<Set<String>> {
        Binding(get: { Set(m.profile[keyPath: key] ?? []) }, set: { v in
            var q = m.profile
            // someone from before the questions answering one of them: the other starts as
            // what Splitlife was made for (a student with a job, in a shared flat)
            if q.share == nil { q.share = ["flatmates"] }
            if q.doing == nil { q.doing = ["study", "shifts"] }
            let order = key == \Profile.share ? Life.Share.allCases.map(\.rawValue) : Life.Doing.allCases.map(\.rawValue)
            q[keyPath: key] = order.filter(v.contains)
            m.saveProfile(q)
        })
    }
}

/// Settings → Import shifts: pick a file, see what's new, add it (ShiftImport.swift).
private struct ImportShifts: ViewModifier {
    @Environment(AppModel.self) private var m
    @Binding var picking: Bool
    @State private var found: ShiftImport.Result?

    func body(content: Content) -> some View {
        content.fileImporter(isPresented: $picking, allowedContentTypes: [.json, .commaSeparatedText, .plainText, .text]) { r in
            guard case .success(let url) = r else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), data.count <= 5_000_000,
                  let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { m.show("Couldn't read that file"); return }
            let res = m.readShifts(text)
            if res.shifts.isEmpty { m.show(res.skipped + res.bad > 0 ? "Nothing new to add — \(ShiftImportNote.text(res))" : "No shifts found in that file") }
            else { found = res }
        }
        .confirmationDialog(found.map { "Add \($0.shifts.count) shift\($0.shifts.count == 1 ? "" : "s")?" } ?? "", isPresented: Binding(get: { found != nil }, set: { if !$0 { found = nil } }), titleVisibility: .visible) {
            Button("Add") { if let f = found { m.addImported(f.shifts) }; found = nil }
        } message: {
            if let f = found, f.skipped + f.bad > 0 { Text(ShiftImportNote.text(f)) }
        }
    }
}
