import SwiftUI

/// "⋯" on a group's card → Group settings: its name and what it's for, everyone in it (rename,
/// invite link, remind, remove), the code, how debts show, and leaving or deleting it — the web
/// app's GroupSettingsPage.
struct GroupSettingsView: View {
    @Environment(AppModel.self) private var m
    let id: String
    @State private var name = ""
    @State private var purpose = "other"
    @State private var person: Member?
    @State private var renaming: Member?
    @State private var newName = ""
    @State private var removing: Member?
    @State private var confirmLeave = false
    @State private var confirmDelete = false

    private var flat: Flat? { m.flat?.id == id ? m.flat : nil }
    private var people: [Member] {
        func order(_ x: Member) -> Int { x.userId == m.uid ? 0 : x.hasLeft ? 3 : x.isPending ? 2 : 1 }
        return m.members.sorted { order($0) != order($1) ? order($0) < order($1) : $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
    private func net(_ u: String) -> Int { m.book.netMinor[u] ?? 0 }
    private func status(_ x: Member) -> String {
        x.userId == m.uid ? "You" : x.hasLeft ? "Left" : x.isPending ? (x.inviteEmail.map { "Invited · \($0)" } ?? "Invited by link") : "Joined"
    }
    /// nobody else has ever joined, or every balance is zero: deleting can't make a debt disappear
    private var canDelete: Bool {
        !m.members.contains { $0.userId != m.uid && $0.claimedAt != nil } || m.book.netMinor.values.allSatisfy { $0 == 0 }
    }

    var body: some View {
        Group {
            if let flat { form(flat) } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .navigationTitle("Group settings")
        .navigationBarTitleDisplayMode(.inline)
        .heimatSurface()
        .onAppear { if let flat { name = flat.name; purpose = flat.purposeKey } }
        .onChange(of: flat?.name) { _, v in if let v { name = v } }
    }

    private func inviteText(_ flat: Flat) -> String {
        let link = Secrets.publicURL + "join.html?c=" + flat.joinCode
        return "Join my group “" + flat.name + "” on Splitlife: " + link + "\n(or type the code " + flat.joinCode + " in Splitlife → Join with code)"
    }
    private func balanceText(_ minor: Int) -> String {
        (minor > 0 ? "+" : "−") + m.fH(Money.toMajor(abs(minor), m.book.currency))
    }

    private func personRow(_ x: Member) -> some View {
        let n = net(x.userId)
        let you = x.userId == m.uid ? " (you)" : ""
        return HStack(spacing: 12) {
            AvatarView(name: x.displayName, seed: x.userId, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(x.displayName + you).foregroundStyle(.primary)
                Text(status(x)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if n != 0 {
                Text(balanceText(n))
                    .font(.system(size: 14, weight: .bold)).monospacedDigit()
                    .foregroundStyle(n > 0 ? Color.hGreen : Color.hRed)
            }
        }
    }

    @ViewBuilder private func form(_ flat: Flat) -> some View {
        Form {
            Section("Group") {
                TextField("Group name", text: $name)
                VStack(alignment: .leading, spacing: 8) {
                    Text("What's it for?").font(.subheadline).foregroundStyle(.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                        ForEach(Flat.purposes, id: \.0) { key, emoji, label in
                            Button { purpose = key; Haptic.tap() } label: {
                                Text("\(emoji) \(label)").font(.system(size: 14, weight: .semibold))
                                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                                    .background(purpose == key ? Color.hGreen.opacity(0.16) : Color.clear, in: Capsule())
                                    .overlay(Capsule().strokeBorder(purpose == key ? Color.hGreen : Color.secondary.opacity(0.3), lineWidth: 1.5))
                                    .foregroundStyle(purpose == key ? Color.hGreen : .primary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(purpose == key ? .isSelected : [])
                        }
                    }
                }
                .padding(.vertical, 4)
                if name.trimmingCharacters(in: .whitespacesAndNewlines) != flat.name || purpose != flat.purposeKey {
                    AsyncButton(action: {
                        if let e = await m.updateGroup(id, name: name, purpose: purpose) { m.show(e) } else { m.show("Group saved") }
                    }) { Text("Save").frame(maxWidth: .infinity) }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }

            Section {
                ForEach(people) { x in
                    Button { person = x } label: { personRow(x) }
                }
                Button { m.sheet = .invite } label: { Label("Invite people", systemImage: "person.badge.plus") }
            } header: { Text("People · \(m.roster.count)") } footer: {
                Text("Tap someone to rename them, send their link, remind them or remove them. Someone up or down has to settle up before they can be removed.")
            }

            Section {
                Button {
                    UIPasteboard.general.string = flat.joinCode
                    Haptic.success()
                    m.show("Group code copied")
                } label: { LabeledContent { Text(flat.joinCode).monospaced() } label: { Label("Copy the code", systemImage: "doc.on.doc") } }
                ShareLink(item: inviteText(flat)) {
                    Label("Share an invite", systemImage: "square.and.arrow.up")
                }
            } header: { Text("Group code") } footer: { Text("Anyone with the code can join from Splitlife → Join with code.") }

            Section("Money") {
                Toggle(isOn: Binding(get: { m.isSimplified(id) }, set: { v in Task { await m.setSimplify(v) } })) {
                    Label { VStack(alignment: .leading, spacing: 1) { Text("Simplify debts"); Text("Fewer payments for everyone").font(.caption).foregroundStyle(.secondary) } }
                        icon: { Image(systemName: "arrow.triangle.branch") }
                }
                Button { m.sheet = .categories } label: { Label("Categories", systemImage: "tag") }
            }

            Section {
                Button(role: .destructive) { confirmLeave = true } label: { Label("Leave “\(flat.name)”", systemImage: "rectangle.portrait.and.arrow.right") }
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete group", systemImage: "trash") }.disabled(!canDelete)
            } footer: {
                Text(canDelete ? "Deleting removes the group and everything in it for everyone." : "A group can be deleted once everyone is settled up — or while nobody else has joined.")
            }
        }
        .tint(.primary)
        .confirmationDialog(person?.displayName ?? "", isPresented: personShown, titleVisibility: .visible) {
            if let x = person { personActions(x, flat) }
        } message: {
            if let x = person, x.userId != m.uid, !x.isPending, !x.hasLeft { Text("Only they can change the name they go by.") }
        }
        .alert(renameTitle, isPresented: renameShown) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { saveRename() }
        }
        .confirmationDialog(removeTitle(flat), isPresented: removeShown, titleVisibility: .visible) {
            Button(removing?.isPending == true ? "Withdraw invite" : "Remove", role: .destructive) { doRemove() }
        }
        .confirmationDialog("Leave this group? You'll stop seeing its shared bills.", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave group", role: .destructive) { Task { m.groupsPath = []; await m.leaveFlat() } }
        }
        .confirmationDialog(deleteTitle(flat), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete group", role: .destructive) { Task { await m.deleteGroup(id) } }
        }
    }

    // MARK: someone's options

    private var personShown: Binding<Bool> { Binding(get: { person != nil }, set: { if !$0 { person = nil } }) }
    private var renameShown: Binding<Bool> { Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }) }
    private var removeShown: Binding<Bool> { Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }) }
    private var renameTitle: String {
        guard let x = renaming else { return "" }
        return x.userId == m.uid ? "Your name in this group" : "Rename " + x.displayName
    }
    private func removeTitle(_ flat: Flat) -> String {
        guard let x = removing else { return "" }
        return x.isPending ? "Withdraw " + x.displayName + "'s invite?" : "Remove " + x.displayName + " from “" + flat.name + "”?"
    }
    private func deleteTitle(_ flat: Flat) -> String {
        "Delete “" + flat.name + "”? The group and everything in it — expenses, payments, bills, chores — is gone for everyone. This can't be undone."
    }
    private func remindText(_ x: Member) -> String {
        "Remind them · " + m.fH(Money.toMajor(-net(x.userId), m.book.currency))
    }
    private func saveRename() {
        guard let x = renaming else { return }
        let n = newName
        Task { if let e = await m.renameMember(x, to: n) { m.show(e) } else { m.show("Name changed") } }
    }
    private func doRemove() {
        guard let x = removing else { return }
        Task { if x.isPending { await m.revokeInvite(x.id) } else { await m.remove(x) } }
    }

    @ViewBuilder private func personActions(_ x: Member, _ flat: Flat) -> some View {
        let me = x.userId == m.uid
        let waiting = x.isPending && !x.hasLeft
        if me || waiting {
            Button(me ? "Change your name here" : "Rename") { newName = x.displayName; renaming = x }
        }
        if waiting, let link = x.inviteLink {
            Button("Copy their invite link") { UIPasteboard.general.string = link; m.show("Link for " + x.displayName + " copied") }
        }
        if !me && !x.hasLeft && net(x.userId) < 0 {
            Button(remindText(x)) { Task { await m.nudge(x) } }
        }
        if !me && !x.hasLeft {
            Button(waiting ? "Withdraw invite" : "Remove from " + flat.name, role: .destructive) { removing = x }
        }
        if me {
            Button("Leave the group", role: .destructive) { confirmLeave = true }
        }
    }
}
