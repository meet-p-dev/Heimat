import SwiftUI

struct ExpenseDraft {
    /// which flat or group it belongs to; nil means the one that is open
    var flatId: String?
    var desc: String
    var amount: Double
    var paidBy: String
    var among: [String]
    var category: String
    var spentOn: String
}

struct ExpenseForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let editing: Expense?
    let prefill: ExpensePrefill?
    @State private var amount = ""
    @State private var desc = ""
    @State private var payer = ""
    @State private var among: Set<String> = []
    @State private var cat = "groceries"
    @State private var date = Date()
    @State private var confirmDelete = false
    /// where it lands. Home can reach any flat, so this is not always the open one.
    @State private var target = ""

    private var people: [Member] {
        let list = m.members(of: target)
        return list.isEmpty ? m.members : list
    }

    var body: some View {
        let v = Fmt.parse(amount)
        let valid = v > 0 && !among.isEmpty && !payer.isEmpty && !target.isEmpty
        let everyone = among.count == people.count
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("0,00", text: $amount).keyboardType(.decimalPad)
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                        Text(m.hostCur).font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                    }
                } header: { Text("How much?") } footer: {
                    if m.homeCur != m.hostCur && v > 0 { Text("≈ \(Fmt.money(v * m.profile.rate, m.homeCur)) in your home currency") }
                }
                Section {
                    TextField("What for? e.g. Rewe groceries", text: $desc)
                    if m.flats.count > 1 {
                        Picker("Flat", selection: $target) {
                            ForEach(m.flats) { f in
                                Label(f.name, systemImage: f.isGroup ? "person.2.fill" : "house.fill").tag(f.id)
                            }
                        }
                        // moving an expense between flats would rewrite whose
                        // debt it is, so it is only a choice when adding
                        .disabled(editing != nil)
                    }
                    Picker("Category", selection: $cat) { ForEach(m.cats) { Label($0.label, systemImage: $0.symbol).tag($0.id) } }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Paid by", selection: $payer) { ForEach(people) { Text(m.nameOf($0.userId, in: target)).tag($0.userId) } }
                } footer: {
                    Button("Edit categories") { m.sheet = .categories }.font(.footnote)
                }
                Section {
                    ForEach(people) { mem in
                        let on = among.contains(mem.userId)
                        Button {
                            Haptic.tap()
                            if on { among.remove(mem.userId) } else { among.insert(mem.userId) }
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(name: mem.displayName, seed: mem.userId, size: 30)
                                Text(m.nameOf(mem.userId, in: target)).foregroundStyle(.primary)
                                Spacer()
                                if on { Text(Fmt.money(v / Double(max(among.count, 1)), m.hostCur)).monospacedDigit().foregroundStyle(.secondary) }
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(on ? Color.accentColor : Color.secondary)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Split between · \(among.count)")
                        Spacer()
                        Button(everyone ? "Just me" : "Everyone") {
                            among = everyone ? Set([m.uid].compactMap { $0 }) : Set(people.map(\.userId))
                        }
                        .font(.footnote.weight(.semibold)).textCase(nil)
                    }
                }
                if editing != nil {
                    Section { Button("Delete expense", role: .destructive) { confirmDelete = true } }
                }
            }
            .navigationTitle(editing == nil ? "New expense" : "Edit expense")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing == nil ? "Add" : "Save") {
                        let d = ExpenseDraft(flatId: target, desc: desc.trimmingCharacters(in: .whitespaces), amount: v, paidBy: payer,
                                             among: Array(among), category: cat, spentOn: Fmt.ymd(date))
                        Task { if let e = editing { await m.updateExpense(e.id, d) } else { await m.addExpense(d) } }
                        dismiss()
                    }
                    .disabled(!valid)
                }
            }
            .confirmationDialog("Delete this expense for everyone in the flat?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete expense", role: .destructive) { if let e = editing { Task { await m.deleteExpense(e.id) } }; dismiss() }
            }
            .onAppear {
                if let e = editing {
                    target = e.flatId
                    amount = Fmt.input(e.amount); desc = e.description ?? ""; payer = e.paidBy
                    among = Set(e.splitAmong); cat = e.category ?? "other"; date = Fmt.date(e.spentOn) ?? Date()
                } else {
                    target = m.flatId ?? m.flats.first?.id ?? ""
                    desc = prefill?.desc ?? ""; cat = prefill?.category ?? "groceries"
                    payer = m.uid ?? ""; among = Set(people.map(\.userId))
                }
            }
            // a different flat means different people, so the split starts over
            .onChange(of: target) { _, _ in
                guard editing == nil else { return }
                payer = m.uid ?? ""
                among = Set(people.map(\.userId))
            }
        }
    }
}

struct ExpenseDetailView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let expense: Expense

    var body: some View {
        let c = Cats.of(m.cats, expense.category)
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 8) {
                        CatIcon(cat: c, size: 56)
                        Text((expense.description ?? "").isEmpty ? c.label : expense.description!).font(.headline)
                        Text(m.fH(expense.amount)).font(.system(size: 36, weight: .bold, design: .rounded)).monospacedDigit()
                    }
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
                Section {
                    LabeledContent("Paid by", value: m.nameOf(expense.paidBy))
                    LabeledContent("Category", value: c.label)
                    LabeledContent("Date", value: Fmt.relDay(expense.spentOn))
                    LabeledContent("Added by", value: expense.createdBy.map(m.nameOf) ?? "—")
                } footer: { Text("Only the person who added it or the payer can edit it.") }
                Section("Split between · \(expense.parts.count)") {
                    ForEach(expense.parts, id: \.self) { u in
                        HStack(spacing: 12) {
                            AvatarView(name: m.nameOf(u), seed: u, size: 30)
                            Text(m.nameOf(u))
                            Spacer()
                            Text(m.fH(expense.share)).monospacedDigit().foregroundStyle(.tint)
                        }
                    }
                }
            }
            .navigationTitle("Expense")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

struct SettleForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let initial: Calc.Suggestion?
    @State private var from = ""
    @State private var to = ""
    @State private var amount = ""

    var body: some View {
        let suggestions = Calc.suggestions(m.balances)
        let v = Fmt.parse(amount)
        NavigationStack {
            Form {
                if !suggestions.isEmpty {
                    Section {
                        ForEach(suggestions, id: \.self) { s in
                            Button { fill(s) } label: {
                                HStack {
                                    Text(m.nameOf(s.from)); Image(systemName: "arrow.right").foregroundStyle(.secondary); Text(m.nameOf(s.to))
                                    Spacer()
                                    Text(m.fH(s.amount)).bold().monospacedDigit()
                                    if s.from == from && s.to == to { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                                .foregroundStyle(.primary)
                            }
                        }
                    } header: { Label("Suggested", systemImage: "sparkles") } footer: {
                        Text("The fewest payments that square everyone up. Tap one to fill it in.")
                    }
                }
                Section {
                    Picker("Who paid", selection: $from) { ForEach(m.members) { Text(m.nameOf($0.userId)).tag($0.userId) } }
                    Picker("Paid to", selection: $to) { ForEach(m.members) { Text(m.nameOf($0.userId)).tag($0.userId) } }
                } footer: { if !from.isEmpty && from == to { Text("Pick two different people.").foregroundStyle(.red) } }
                Section("Amount (\(m.hostCur))") {
                    TextField("0,00", text: $amount).keyboardType(.decimalPad).font(.title2.weight(.bold))
                }
            }
            .navigationTitle("Settle up")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Record") { Task { await m.settleUp(from: from, to: to, amount: v) }; dismiss() }
                        .disabled(v <= 0 || from.isEmpty || to.isEmpty || from == to)
                }
            }
            .onAppear {
                if let s = initial ?? suggestions.first(where: { $0.from == m.uid || $0.to == m.uid }) ?? suggestions.first { fill(s) }
                else { from = m.uid ?? ""; to = m.members.first { $0.userId != m.uid }?.userId ?? "" }
            }
        }
    }

    private func fill(_ s: Calc.Suggestion) { from = s.from; to = s.to; amount = String(format: "%.2f", s.amount).replacingOccurrences(of: ".", with: ",") }
}

struct CreateJoinForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let mode: FlatMode
    @State private var text = ""

    var body: some View {
        NavigationStack {
            Form {
                if mode == .join {
                    Section {
                        TextField("4B7K9A", text: $text)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.system(size: 28, weight: .bold, design: .monospaced)).multilineTextAlignment(.center)
                            .onChange(of: text) { _, t in text = t.uppercased().replacingOccurrences(of: " ", with: "") }
                    } header: { Text("Flat code") } footer: { Text("Ask a flatmate — it's on their Flat tab.") }
                } else if mode == .group {
                    Section {
                        TextField("e.g. Sicily trip", text: $text)
                    } header: { Text("Group name") } footer: {
                        Text("For splitting with people you don't live with. Add them by email — they don't need a Heimat account first.")
                    }
                } else {
                    Section {
                        TextField("e.g. WG Hauptstraße", text: $text)
                    } header: { Text("Flat name") } footer: { Text("You'll get a code to share with your flatmates.") }
                }
            }
            .navigationTitle(mode == .join ? "Join a flat" : mode == .group ? "New group" : "Create a flat")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton(action: {
                        let name = text.trimmingCharacters(in: .whitespaces)
                        let ok = switch mode {
                        case .join: await m.joinFlat(text)
                        case .group: await m.createGroup(name)
                        case .create: await m.createFlat(name)
                        }
                        if ok { dismiss() }
                    }) { Text(mode == .join ? "Join" : "Create") }
                    .disabled(mode == .join ? text.count < 4 : text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { if mode == .create { text = m.profile.name.isEmpty ? "My flat" : "\(m.firstName)'s flat" } }
        }
        .presentationDetents([.medium])
    }
}

struct InviteView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var mail = ""
    @State private var err: String?
    @State private var revoking: Member?

    private var mailOK: Bool { mail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil }
    private var pending: [Member] { m.members.filter(\.isPending) }

    var body: some View {
        NavigationStack {
            if let flat = m.flat {
                let msg = "Join my \(flat.noun) “\(flat.name)” on Heimat\nCode: \(flat.joinCode)\nOpen \(Secrets.publicURL) → tap “Join with a code”."
                Form {
                    Section {
                        TextField("Name", text: $name).textContentType(.givenName)
                        TextField("Email", text: $mail)
                            .textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        AsyncButton(action: send) {
                            HStack { Spacer(); Text("Send invite").bold(); Spacer() }
                        }
                        .disabled(!mailOK)
                    } header: {
                        Text("Add by email")
                    } footer: {
                        Text("They don't need Heimat yet. Their share counts from the moment you add them, and we'll email them a link to claim it — the history is waiting when they sign up.")
                    }

                    if let err {
                        Section { Label(err, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.subheadline) }
                    }

                    if !pending.isEmpty {
                        Section {
                            ForEach(pending) { p in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(spacing: 12) {
                                        AvatarView(name: p.displayName, seed: p.userId, size: 34)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(p.displayName).font(.system(size: 15.5, weight: .semibold))
                                            Text(p.inviteEmail ?? "").font(.system(size: 12.5)).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                        Spacer(minLength: 6)
                                        sendState(p)
                                    }
                                    if let why = p.inviteError {
                                        Text(why).font(.system(size: 12)).foregroundStyle(.secondary)
                                        if let link = p.inviteLink {
                                            HStack(spacing: 10) {
                                                Button {
                                                    UIPasteboard.general.string = link
                                                    Haptic.success(); m.show("Invite link copied")
                                                } label: { Label("Copy link", systemImage: "link") }
                                                ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
                                            }
                                            .font(.system(size: 13, weight: .semibold))
                                            .buttonStyle(.borderless)
                                        }
                                    }
                                }
                                .swipeActions { Button("Remove", role: .destructive) { revoking = p } }
                            }
                        } header: { Text("Waiting to join") } footer: {
                            Text("Swipe to take an invite back. Anything already split with them comes back to the rest of you.")
                        }
                    }

                    Section {
                        Button {
                            UIPasteboard.general.string = flat.joinCode
                            Haptic.success()
                            m.show("Code copied")
                        } label: {
                            HStack {
                                Text(flat.joinCode).font(.system(size: 22, weight: .heavy, design: .rounded)).kerning(3).foregroundStyle(.tint)
                                Spacer()
                                Image(systemName: "doc.on.doc").foregroundStyle(.secondary)
                            }
                        }
                        ShareLink(item: msg) { Label("Share the code", systemImage: "square.and.arrow.up") }
                    } header: {
                        Text("Or share a code")
                    } footer: {
                        Text("Anyone with an account can type this in — Heimat → Join with a code.")
                    }
                }
                .navigationTitle(flat.isGroup ? "Add people" : "Invite flatmates")
                .heimatSurface()
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog("Remove this invite?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
                    Button("Remove invite", role: .destructive) {
                        if let r = revoking { Task { await m.revokeInvite(r.id) } }
                    }
                }
            }
        }
    }

    /// Three states worth telling apart: we haven't heard yet, it went, or it
    /// didn't — and only the last one needs the link offering underneath.
    @ViewBuilder private func sendState(_ p: Member) -> some View {
        let (text, tint): (String, Color) =
            p.inviteError != nil ? ("Not emailed", .orange)
            : p.inviteSentAt != nil ? ("Emailed", .secondary)
            : ("Sending…", .secondary)
        Text(text).font(.system(size: 11, weight: .bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.16), in: Capsule())
            .foregroundStyle(tint)
    }

    private func send() async {
        err = nil
        if let e = await m.invite(email: mail, name: name) { err = e; return }
        name = ""; mail = ""
    }
}

struct CategoriesView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var icon = "tag"
    @State private var color = Cats.colors[0]

    var body: some View {
        let key = Cats.slug(label)
        let taken = !key.isEmpty && (Cats.builtIn.contains { $0.id == key } || m.flatCats.contains { $0.key == key })
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: Cats.icons.first { $0.key == icon }?.symbol ?? "tag.fill")
                            .foregroundStyle(.white).frame(width: 44, height: 44)
                            .background(Color(hex: color).gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        TextField("e.g. Shopping", text: $label)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 10) {
                        ForEach(Cats.icons, id: \.key) { i in
                            Button { icon = i.key } label: {
                                Image(systemName: i.symbol).frame(width: 40, height: 40)
                                    .background(icon == i.key ? Color(hex: color) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(icon == i.key ? Color.white : Color.secondary)
                            }
                            .buttonStyle(.plain).accessibilityLabel(i.key)
                        }
                    }
                    HStack {
                        ForEach(Cats.colors, id: \.self) { c in
                            Button { color = c } label: {
                                Circle().fill(Color(hex: c)).frame(width: 26, height: 26)
                                    .overlay { if color == c { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: { Text("New category") } footer: {
                    if taken { Text("“\(label)” already exists.").foregroundStyle(.orange) }
                    else { Text("Shared with your flat — used for both list items and expenses.") }
                }
                Section {
                    AsyncButton(action: { await m.addCategory(label: label.trimmingCharacters(in: .whitespaces), icon: icon, color: color); label = "" }) {
                        Text("Add category")
                    }
                    .disabled(key.isEmpty || taken)
                }
                if !m.flatCats.isEmpty {
                    Section("Your flat's categories") {
                        ForEach(m.cats.filter(\.custom)) { c in Label { Text(c.label) } icon: { CatIcon(cat: c, size: 30) } }
                            .onDelete { idx in
                                let custom = m.flatCats
                                idx.forEach { i in if i < custom.count { Task { await m.deleteCategory(custom[i]) } } }
                            }
                    }
                }
                Section("Built in") {
                    ForEach(Cats.builtIn) { c in Label { Text(c.label) } icon: { CatIcon(cat: c, size: 30) } }
                }
            }
            .navigationTitle("Categories")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
