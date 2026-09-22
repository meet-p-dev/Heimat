import SwiftUI

// MARK: - Profile

struct ProfileView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: SheetRoute?

    var body: some View {
        let p = m.profile
        let home = Countries.home.first { $0.name == p.homeCountry }
        let host = Countries.host.first { $0.name == p.hostCountry }
        List {
            Section {
                VStack(spacing: 10) {
                    AvatarView(name: p.name, color: p.avatar, seed: m.uid, size: 92)
                    Text(p.name.isEmpty ? "You" : p.name).font(.title.bold())
                    if m.isAnon {
                        Pill(text: "Guest · this phone only", color: .orange)
                    } else {
                        Pill(text: m.email ?? "Signed in", color: .green)
                    }
                    Text("\(home?.flag ?? "🌍") \(p.homeCountry)  →  \(host?.flag ?? "🌍") \(p.hostCountry)")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Button { sheet = .editProfile } label: { Label("Edit profile", systemImage: "pencil") }
                        .buttonStyle(.glass).padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
            }
            .listRowBackground(Color.clear)

            if m.isAnon {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Don't lose your flat").font(.headline)
                            Text("As a guest, everything lives on this phone. Create a free account so your flat and balances survive a new phone or a reinstall.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    } icon: { SettingIcon(symbol: "exclamationmark.shield.fill", color: .orange) }
                    HStack(spacing: 10) {
                        Button { sheet = .auth(.signup) } label: { Text("Create account").frame(maxWidth: .infinity) }.buttonStyle(.glassProminent)
                        Button { sheet = .auth(.signin) } label: { Text("Sign in").frame(maxWidth: .infinity) }.buttonStyle(.glass)
                    }
                    .controlSize(.large)
                }
            }
            if let pending = m.pendingEmail {
                Section { Label("Confirm \(pending) — open the link we sent to finish.", systemImage: "envelope.badge.fill").font(.subheadline) }
            }

            Section("At a glance") {
                LabeledContent("Earned from work", value: m.fH(m.earnedTotal))
                LabeledContent("Your share of flat bills", value: m.fH(m.spentTotal))
                LabeledContent("Shifts logged", value: "\(m.shifts.count)")
                LabeledContent("Flats", value: "\(m.flats.count)")
            }

            Section {
                ForEach(m.flats) { f in
                    Button { m.switchFlat(f.id); m.tab = .flat; dismiss() } label: {
                        Label {
                            HStack { Text(f.name).foregroundStyle(.primary); Spacer(); if f.id == m.flatId { Image(systemName: "checkmark").foregroundStyle(.tint) } }
                        } icon: { SettingIcon(symbol: "house.fill", color: .green) }
                    }
                }
                if m.flat != nil { Button { sheet = .invite } label: { Label { Text("Invite flatmates") } icon: { SettingIcon(symbol: "person.badge.plus", color: .blue) } } }
                Button { sheet = .flat(.create) } label: { Label { Text("Create a new flat") } icon: { SettingIcon(symbol: "plus", color: .gray) } }
                Button { sheet = .flat(.join) } label: { Label { Text("Join with a code") } icon: { SettingIcon(symbol: "key.fill", color: .gray) } }
            } header: { Text("Your flats") } footer: { Text("Flats sync live with your flatmates. Everything else here stays on this phone.") }
            .tint(.primary)

            Section("Home & money") {
                LabeledContent("Home", value: "\(p.homeCountry) · \(p.homeCur)")
                LabeledContent("Studying in", value: "\(p.hostCountry) · \(p.hostCur)")
                if p.homeCur != p.hostCur { LabeledContent("Exchange rate", value: "1 \(p.hostCur) = \(Fmt.num(p.rate, 2)) \(p.homeCur)") }
            }

            Section {
                NavigationLink { SettingsView() } label: { Label { Text("Settings") } icon: { SettingIcon(symbol: "gearshape.fill", color: .gray) } }
            }
        }
        .navigationTitle("Profile")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close") }
            ToolbarItem(placement: .primaryAction) { Button("Edit") { sheet = .editProfile } }
        }
        .sheet(item: $sheet) { SheetHost(route: $0) }
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
                            .buttonStyle(.glass)
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

struct SettingsView: View {
    @State private var pushOn = false
    @State private var pushDenied = false
    @State private var cloudOn = CloudBackup.shared.enabled
    @State private var lastBackup: Date?
    @State private var confirmRestore = false

    /// On means: the user asked for it *and* iOS still allows it.
    private func pushState() async -> Bool {
        // `&&` takes its right side as an autoclosure, which cannot be awaited
        guard Push.shared.wanted else { return false }
        return await Push.shared.permission() == .authorized
    }
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: SheetRoute?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var confirmClear = false
    @State private var jsonURL: URL?
    @State private var csvURL: URL?

    var body: some View {
        @Bindable var m = m
        let p = m.profile
        Form {
            Section {
                if m.isAnon {
                    Button { sheet = .auth(.signup) } label: { row("person.crop.circle.badge.plus", .green, "Create account", sub: "Free — keeps your flat if you change phone") }
                    Button { sheet = .auth(.signin) } label: { row("person.crop.circle", .blue, "Sign in", sub: "Already have a Heimat account") }
                } else {
                    Button { sheet = .auth(.email) } label: {
                        Label { LabeledContent("Email", value: m.email ?? "") } icon: { SettingIcon(symbol: "envelope.fill", color: .blue) }
                    }
                    Button { sheet = .auth(.password) } label: { row("lock.fill", .gray, "Change password") }
                    Button { confirmSignOut = true } label: { row("rectangle.portrait.and.arrow.right", .gray, "Sign out") }
                }
            } header: { Text("Account") } footer: {
                if let pending = m.pendingEmail { Text("Waiting for you to confirm \(pending).") }
                else if m.isAnon { Text("You're using Heimat as a guest. An account keeps your flat if you change phone or reinstall.") }
            }
            .tint(.primary)

            Section("Appearance") {
                Picker(selection: $m.prefs.theme) {
                    ForEach(ThemeMode.allCases) { Text($0.label).tag($0) }
                } label: { row("circle.lefthalf.filled", .indigo, "Theme") }
            }

            Section {
                Toggle(isOn: Binding(get: { pushOn }, set: { on in
                    Task {
                        if on {
                            if let why = await Push.shared.enable() {
                                pushDenied = why == "denied"
                            }
                        } else {
                            Push.shared.disable()
                        }
                        pushOn = await pushState()
                    }
                })) {
                    Label { Text("Notifications") } icon: { SettingIcon(symbol: "bell.fill", color: .red) }
                }
                .disabled(pushDenied)
            } header: { Text("Notifications") } footer: {
                Text(pushDenied
                     ? "Blocked in iOS Settings — turn Heimat's notifications back on there."
                     : "A nudge when a flatmate adds an expense or settles up.")
            }
            .task { pushOn = await pushState(); pushDenied = await Push.shared.permission() == .denied }

            Section {
                Toggle(isOn: Binding(get: { cloudOn }, set: { on in
                    CloudBackup.shared.enabled = on
                    cloudOn = on
                    if on { CloudBackup.shared.back(up: m) }
                    else { CloudBackup.shared.turnOff() }
                    lastBackup = CloudBackup.shared.lastBackup
                })) {
                    Label { Text("Back up to iCloud") } icon: { SettingIcon(symbol: "icloud.fill", color: .blue) }
                }
                .disabled(!CloudBackup.shared.available)

                if cloudOn {
                    Button {
                        CloudBackup.shared.back(up: m)
                        lastBackup = CloudBackup.shared.lastBackup
                        Haptic.success()
                        m.show("Backed up to iCloud")
                    } label: {
                        LabeledContent {
                            Text(lastBackup.map { Fmt.relDay(Fmt.ymd($0)) } ?? "Never")
                                .foregroundStyle(.secondary)
                        } label: {
                            Label { Text("Back up now") } icon: { SettingIcon(symbol: "arrow.clockwise.icloud", color: .teal) }
                        }
                    }
                    if CloudBackup.shared.peek() != nil {
                        Button { confirmRestore = true } label: {
                            row("arrow.down.circle", .indigo, "Restore from iCloud",
                                sub: "Replaces the shifts on this phone")
                        }
                    }
                }
            } header: { Text("iCloud") } footer: {
                Text(CloudBackup.shared.available
                     ? "Your profile and shifts are copied to your own iCloud so a new phone can pick them up. Nothing goes to Heimat's servers."
                     : "Sign in to iCloud on this phone to back up your profile and shifts.")
            }
            .task { lastBackup = CloudBackup.shared.lastBackup }

            Section {
                Button { sheet = .editProfile } label: {
                    Label { LabeledContent("Currencies", value: p.homeCur == p.hostCur ? p.hostCur : "\(p.hostCur) → \(p.homeCur)") } icon: { SettingIcon(symbol: "globe", color: .teal) }
                }
                if p.homeCur != p.hostCur {
                    LabeledContent {
                        Text("\(Fmt.num(p.rate, 2)) \(p.homeCur)").monospacedDigit()
                    } label: {
                        Label { VStack(alignment: .leading) { Text("Exchange rate"); Text(p.rateAt.map { "Updated \(Fmt.relDay($0).lowercased())" } ?? "Set by hand").font(.caption).foregroundStyle(.secondary) } } icon: { SettingIcon(symbol: "arrow.left.arrow.right", color: .gray) }
                    }
                    Toggle(isOn: $m.prefs.autoRate) { row("arrow.clockwise", .green, "Update daily") }
                    AsyncButton(action: {
                        if let r = await m.refreshRate() { m.show("1 \(p.hostCur) = \(Fmt.num(r, 2)) \(p.homeCur)") } else { m.show("Couldn't reach the rate service") }
                    }) { Text("Update rate now") }
                }
            } header: { Text("Currency") } footer: { Text("Rates come from open.er-api.com and are for reference only.") }
            .tint(.primary)

            Section {
                Stepper(value: $m.prefs.yearDays, in: 10...365, step: 5) {
                    Label { LabeledContent("Days per year", value: "\(m.prefs.yearDays)") } icon: { SettingIcon(symbol: "calendar", color: .orange) }
                }
                Stepper(value: $m.prefs.weekCap, in: 1...60) {
                    Label { LabeledContent("Hours per week", value: "\(m.prefs.weekCap) h") } icon: { SettingIcon(symbol: "timer", color: .orange) }
                }
                if m.prefs.weekCap != 20 || m.prefs.yearDays != 120 {
                    Button("Reset to Germany's limits") { m.prefs.weekCap = 20; m.prefs.yearDays = 120 }
                }
            } header: { Text("Work limits") } footer: {
                Text("Germany: about 120 full days (or 240 half days) a year, and 20 hours a week during term. Other countries differ — check with your international office.")
            }

            Section("General") {
                Toggle(isOn: $m.prefs.haptics) { row("hand.tap.fill", .pink, "Haptic feedback") }
            }
            .tint(.primary)

            Section {
                if let jsonURL {
                    ShareLink(item: jsonURL) { row("square.and.arrow.up", .blue, "Export my data", sub: "Profile and shifts as JSON") }
                }
                if let csvURL, !m.shifts.isEmpty {
                    ShareLink(item: csvURL) { row("tablecells", .green, "Export shifts", sub: "CSV for timesheets or your tax return") }
                }
                Button { confirmClear = true } label: { row("trash", .red, "Clear data on this phone", sub: "Removes your logged shifts") }
                Link(destination: URL(string: Secrets.publicURL + "legal/privacy.html")!) { row("hand.raised.fill", .gray, "Privacy policy") }
                Link(destination: URL(string: Secrets.publicURL + "legal/terms.html")!) { row("doc.text.fill", .gray, "Terms of use") }
            } header: { Text("Data & privacy") } footer: {
                Text("Your profile and shifts are stored only on this phone. Shared flat data syncs only with your flatmates.")
            }
            .tint(.primary)

            Section("About") {
                LabeledContent("Version", value: "\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0") (native)")
                if let uid = m.uid {
                    Button { UIPasteboard.general.string = uid; m.show("Account ID copied") } label: {
                        LabeledContent("Account ID", value: String(uid.prefix(8)) + "…")
                    }
                    .tint(.primary)
                }
            }

            Section {
                Button(role: .destructive) { confirmDelete = true } label: { Text("Delete account") }
            } footer: {
                Text("Leaves every flat and removes everything stored about you on the server. Shared expenses stay with the flat, without your name. This cannot be undone.")
            }
        }
        .navigationTitle("Settings")
        .heimatSurface()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .sheet(item: $sheet) { SheetHost(route: $0) }
        .task { jsonURL = m.exportJSON(); csvURL = m.exportCSV() }
        .confirmationDialog("Restore from iCloud? The shifts on this phone are replaced by the backup.", isPresented: $confirmRestore, titleVisibility: .visible) {
            Button("Restore", role: .destructive) { _ = CloudBackup.shared.restore(into: m) }
        }
        .confirmationDialog("Sign out? Your flat stays safe — sign back in any time with your email.", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await m.signOut(); dismiss() } }
        }
        .confirmationDialog("Clear the shifts stored on this phone? Your account, profile and flats aren't affected.", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear data", role: .destructive) { m.clearLocal() }
        }
        .confirmationDialog("Delete your Heimat account? You leave every flat and everything stored about you on the server is removed. This cannot be undone.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { Task { if let e = await m.deleteAccount() { m.show(e) } } }
        }
    }

    private func row(_ symbol: String, _ color: Color, _ title: String, sub: String? = nil) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(.primary)
                if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
            }
        } icon: { SettingIcon(symbol: symbol, color: color) }
    }
}
