import SwiftUI

struct ExpenseDraft {
    /// set for a new expense: made on the phone so the split previewed is the split saved
    var id: String? = nil
    /// which flat or group it belongs to; nil means the one that is open
    var flatId: String?
    var desc: String
    var amount: Double
    var paidBy: String
    var among: [String]
    var category: String
    var spentOn: String
    /// engine v2: how it is split (equal, exact, percent, shares, adjust, itemized) and the figures for it
    var splitType = "equal"
    var split: SplitData? = nil
    /// minor units each person paid, when more than one did
    var payers: [String: Int]? = nil
    /// the expense's currency; nil: the app's host currency
    var currency: String? = nil
}

struct ExpenseForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let editing: Expense?
    let prefill: ExpensePrefill?
    @State private var amount = ""
    @State private var desc = ""
    @State private var payer = ""
    @State private var split = SplitState()
    @State private var cat = "groceries"
    /// once you pick a category yourself, typing stops suggesting one
    @State private var catTouched = false
    @State private var learned = Suggest.Learned()
    @State private var date = Date()
    @State private var confirmDelete = false
    /// lowercased because the database hands uuids back lowercase, and the id
    /// seeds who takes the odd cent — it has to be the same string before and after saving
    @State private var draftId = UUID().uuidString.lowercased()
    /// where it lands: a group, or the circle behind a non-group expense. Home can
    /// reach any group, so this is not always the open one.
    @State private var target = ""
    @State private var choosing = false
    @State private var resolving = false

    private var people: [Member] {
        let list = m.members(of: target)
        return list.isEmpty ? m.members : list
    }

    var body: some View {
        let cur = editing?.currency ?? m.hostCur
        let v = Fmt.amount(amount, cur)
        let total = Money.toMinor(v, cur) ?? 0
        let seed = editing?.id ?? draftId
        // exactly what each person will be charged: whole cents that add up to the total
        let built = split.build(cur)
        let result = Ledger.computeShares(total, built.spec, seed: seed)
        let paid = split.payers(cur)
        let paidOK = split.severalPaid ? paid.map { !$0.isEmpty && $0.values.reduce(0, +) == total } ?? false : !payer.isEmpty
        let splitOK = built.unreadable == nil && { if case .ok = result { true } else { false } }()
        let valid = v > 0 && splitOK && paidOK && !target.isEmpty && !resolving
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("0,00", text: $amount).keyboardType(.decimalPad)
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                        Text(cur).font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                    }
                } header: { Text("How much?") } footer: {
                    if !amount.isEmpty && v <= 0 { Text("Enter an amount like 12,50").foregroundStyle(.red) }
                    else if cur == m.hostCur && m.homeCur != m.hostCur && v > 0 { Text("≈ \(Fmt.money(v * m.profile.rate, m.homeCur)) in your home currency") }
                }
                Section {
                    // a group, or people outside any group. A group expense stays in its
                    // group (moving it would rewrite whose debt it is); a non-group
                    // expense can change its people, and moves to their circle
                    Button { choosing = true } label: {
                        HStack {
                            Text("With you and").foregroundStyle(.primary)
                            Spacer()
                            if resolving { ProgressView() } else {
                                Label(withSummary, systemImage: m.isCircle(target) ? "person.2.fill" : target.isEmpty ? "plus" : "person.3.fill")
                                    .foregroundStyle(target.isEmpty ? Color.accentColor : Color.secondary).lineLimit(1)
                            }
                        }
                    }
                    .disabled(editing.map { !m.isCircle($0.flatId) } ?? false)
                    TextField("What for? e.g. Rewe groceries", text: $desc)
                        .onChange(of: desc) { _, d in
                            guard !catTouched, let s = Suggest.category(d, learned, known: { id in m.cats.contains { $0.id == id } }) else { return }
                            cat = s
                        }
                    Picker("Category", selection: Binding(get: { cat }, set: { cat = $0; catTouched = true })) { ForEach(m.cats) { Label($0.label, systemImage: $0.symbol).tag($0.id) } }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Paid by", selection: payerChoice) {
                        ForEach(people) { Text(m.nameOf($0.userId, in: target)).tag($0.userId) }
                        Divider()
                        Text("Several people").tag(Self.several)
                    }
                } footer: {
                    Button("Edit categories") { m.sheet = .categories }.font(.footnote)
                }
                if split.severalPaid {
                    PayersEditor(s: $split, people: people, total: total, cur: cur, name: { m.nameOf($0, in: target) })
                }
                SplitEditor(s: $split, people: people, total: total, cur: cur, seed: seed, result: result, unreadable: built.unreadable,
                            name: { m.nameOf($0, in: target) }, setTotal: { amount = Money.input($0, cur) })
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
                        guard case .ok(let owed) = result else { return }
                        // several payers only when it really was several; paid_by is the one who put down most
                        let payers = split.severalPaid ? paid ?? [:] : [:]
                        let paidBy = payers.count > 1
                            ? payers.sorted { $0.value != $1.value ? $0.value > $1.value : Ledger.less($0.key, $1.key) }[0].key
                            : payers.first?.key ?? payer
                        // equal and adjusted splits are worked out from who is ticked; the rest from their figures
                        let among = split.mode == .equal || split.mode == .adjust
                            ? split.among.sorted(by: Ledger.less) : owed.keys.sorted(by: Ledger.less)
                        let d = ExpenseDraft(id: editing == nil ? draftId : nil, flatId: target, desc: desc.trimmingCharacters(in: .whitespaces), amount: v, paidBy: paidBy,
                                             among: among, category: cat, spentOn: Fmt.ymd(date), splitType: split.mode.rawValue,
                                             split: split.data(built.spec), payers: payers.count > 1 ? payers : nil, currency: cur)
                        if m.isCircle(target) {
                            let others = people.map(\.userId).filter { $0 != m.uid }
                            let id = editing?.id ?? draftId, edit = editing != nil
                            Task { _ = await m.saveFriendExpense(id, people: others, d, editing: edit) }
                        } else {
                            Task { if let e = editing { await m.updateExpense(e.id, d) } else { await m.addExpense(d) } }
                        }
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
                    amount = Money.input(Money.toMinor(e.amount, e.currency) ?? 0, e.currency); desc = e.description ?? ""; payer = e.paidBy
                    split = SplitState.from(e); cat = e.category ?? "other"; date = Fmt.date(e.spentOn) ?? Date()
                    catTouched = true
                } else {
                    desc = prefill?.desc ?? ""; cat = prefill?.category ?? "groceries"
                    catTouched = prefill?.category != nil
                    // what you filed things under before, newest first (Suggest.swift)
                    learned = Suggest.learn(m.allExpenses.filter { $0.createdBy == m.uid || $0.paidBy == m.uid }
                        .sorted { $0.spentOn > $1.spentOn }
                        .compactMap { e in e.category.map { (description: e.description ?? "", category: $0) } })
                    if let picks = prefill?.people {
                        // from Non-group expenses or a person's page: those people, or choose them now
                        if picks.isEmpty { choosing = true } else { Task { await choose(.people(picks)) } }
                    } else {
                        target = m.flatId ?? m.flats.first?.id ?? ""
                    }
                    payer = m.uid ?? ""; split = SplitState(among: Set(people.map(\.userId)))
                }
            }
            .sheet(isPresented: $choosing) {
                WithPicker(group: m.isCircle(target) ? nil : target,
                           people: m.isCircle(target) ? people.filter { $0.userId != m.uid }.map { PersonPick(userId: $0.userId, name: m.personName($0.userId)) } : [],
                           groupsAllowed: editing == nil) { c in
                    choosing = false
                    Task { await choose(c) }
                }
            }
            // a new way of splitting starts from where the equal split stood
            .onChange(of: split.mode) { _, mode in split.start(mode, total: total, cur: cur, seed: seed) }
            .scrollDismissesKeyboard(.interactively)
            // a different flat means different people, so the split starts over
            .onChange(of: target) { _, _ in
                // new people: an even split between all of them, paid by you (an edit
                // keeps its payer while they are still on it)
                if editing == nil || !people.contains(where: { $0.userId == payer }) { payer = m.uid ?? "" }
                split = SplitState(among: Set(people.map(\.userId)))
            }
        }
    }
}

extension ExpenseForm {
    static let several = "\u{0}several"

    /// "Münchener Straße 67", "Nina, Tom", or "Choose"
    private var withSummary: String {
        if target.isEmpty { return "Choose" }
        if !m.isCircle(target) { return m.flatName(target) }
        let names = people.filter { $0.userId != m.uid }.map { m.personName($0.userId) }
        return names.isEmpty ? "Choose" : names.joined(separator: ", ")
    }

    /// A group is the target as it is; people are turned into their circle first
    /// (found or made by the server), so the split has their ids to work with.
    private func choose(_ c: WithChoice) async {
        switch c {
        case .group(let id): target = id
        case .people(let picks):
            if picks.count == 1, let u = picks[0].userId, let pair = m.pairCircle(with: u) { target = pair; return }
            resolving = true
            if let id = await m.friendCircle(picks) { target = id }
            resolving = false
        }
    }

    /// "Paid by" is one person, or "Several people", which opens a row per person
    private var payerChoice: Binding<String> {
        Binding(get: { split.severalPaid ? Self.several : payer }, set: { v in
            if v == Self.several {
                // start from what was there: the one payer paid it all
                if split.payers(editing?.currency ?? m.hostCur)?.isEmpty ?? true { split.paid = payer.isEmpty ? [:] : [payer: amount] }
                split.severalPaid = true
            } else {
                split.severalPaid = false
                payer = v
            }
        })
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
                        Text(Fmt.money(expense.amount, expense.currency)).font(.system(size: 36, weight: .bold, design: .rounded)).monospacedDigit()
                    }
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
                Section {
                    if let p = Ledger.postings(expense), p.paid.count > 1 {
                        // several people paid: each of them, most first
                        ForEach(p.paid.sorted { $0.value != $1.value ? $0.value > $1.value : Ledger.less($0.key, $1.key) }, id: \.key) { u, minor in
                            LabeledContent("Paid by \(m.nameOf(u))", value: Fmt.money(Money.toMajor(minor, expense.currency), expense.currency))
                        }
                    } else {
                        LabeledContent("Paid by", value: m.nameOf(expense.paidBy))
                    }
                    LabeledContent("Category", value: c.label)
                    LabeledContent("Date", value: Fmt.relDay(expense.spentOn))
                    LabeledContent("Added by", value: expense.createdBy.map(m.nameOf) ?? "—")
                } footer: { Text("Only the person who added it or the payer can edit it.") }
                // whole cents that add up to the total above (10 € between three: 3,34 + 3,33 + 3,33)
                Section("Split \((SplitMode(rawValue: expense.splitType ?? "equal") ?? .equal).title) · \(Ledger.shares(expense).count)") {
                    ForEach(Ledger.shares(expense), id: \.uid) { u, minor in
                        HStack(spacing: 12) {
                            AvatarView(name: m.nameOf(u), seed: u, size: 30)
                            Text(m.nameOf(u))
                            Spacer()
                            Text(Fmt.money(Money.toMajor(minor, expense.currency), expense.currency)).monospacedDigit().foregroundStyle(.tint)
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
        let suggestions = Calc.suggestions(m.book)
        let v = Fmt.amount(amount, m.book.currency)
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
                Section("Amount (\(m.book.currency))") {
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

    /// straight from whole cents, so the field says exactly what the button said —
    /// "%.2f" rounds half to even and could put 11,12 in the field under an 11,13 button
    private func fill(_ s: Calc.Suggestion) { from = s.from; to = s.to; amount = Money.input(Money.toMinor(s.amount, m.book.currency) ?? 0, m.book.currency) }
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
                            // from a group's invite link
                            .onAppear { if let c = m.joinPrefill { text = c; m.joinPrefill = nil } }
                    } header: { Text("Group code") } footer: { Text("Ask someone in the group — it's on the group's page. Been in this group before and deleted your account? Ask someone in it to invite you back instead, so your history comes with you.") }
                } else if mode == .group {
                    Section {
                        TextField("e.g. WG Hauptstraße, Sicily trip", text: $text)
                    } header: { Text("Group name") } footer: {
                        Text("Your flat, a trip, a team — anyone you split with. Invite them with the code or by email; they don't need a Splitlife account first.")
                    }
                } else {
                    Section {
                        TextField("e.g. WG Hauptstraße", text: $text)
                    } header: { Text("Flat name") } footer: { Text("You'll get a code to share with your flatmates.") }
                }
            }
            .navigationTitle(mode == .join ? "Join a group" : mode == .group ? "New group" : "Create a flat")
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
    /// people who left, invited back: their personal links
    @State private var backLinks: [String: URL] = [:]
    @State private var inviting: String?

    private var mailOK: Bool { mail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil }
    private var pending: [Member] { m.members.filter(\.isPending) }
    private var gone: [Member] { m.members.filter(\.hasLeft) }

    var body: some View {
        NavigationStack {
            if let flat = m.flat {
                let msg = "Join my \(flat.noun) “\(flat.name)” on Splitlife: \(Secrets.publicURL)join.html?c=\(flat.joinCode)\n(or type the code \(flat.joinCode) in Splitlife → Join with a code)"
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
                        Text("They don't need Splitlife yet. Their share counts from the moment you add them, and we'll email them a link to claim it — the history is waiting when they sign up.")
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

                    if !gone.isEmpty {
                        Section {
                            ForEach(gone) { p in
                                HStack(spacing: 12) {
                                    AvatarView(name: p.displayName, seed: p.userId, size: 34)
                                    Text(p.displayName).lineLimit(1)
                                    Spacer()
                                    if let url = backLinks[p.id] {
                                        ShareLink(item: url, message: Text("Come back to “\(flat.name)” on Splitlife — open this and your history comes with you: ")) {
                                            Label("Send link", systemImage: "square.and.arrow.up").font(.system(size: 13, weight: .semibold))
                                        }
                                        .buttonStyle(.borderless)
                                    } else {
                                        Button {
                                            inviting = p.id
                                            Task {
                                                if let url = await m.inviteBack(p) { backLinks[p.id] = url }
                                                inviting = nil
                                            }
                                        } label: {
                                            if inviting == p.id { ProgressView() } else { Text("Invite back").font(.system(size: 13, weight: .semibold)) }
                                        }
                                        .buttonStyle(.borderless)
                                        .disabled(inviting != nil)
                                    }
                                }
                            }
                        } header: { Text("People who left") } footer: {
                            Text("Invite someone back and their personal link gives them their old place — expenses, payments and balance — on whatever account they open it with. Someone who still has their account can simply join again with the code.")
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
                        Text("Anyone with an account can type this in — Splitlife → Join with a code.")
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

enum WithChoice { case group(String), people([PersonPick]) }

/// Who an expense is with: people (found by name, email or from contacts) or
/// one of your groups.
struct WithPicker: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let group: String?
    @State var people: [PersonPick]
    var groupsAllowed = true
    let done: (WithChoice) -> Void
    @State private var query = ""

    init(group: String?, people: [PersonPick], groupsAllowed: Bool, done: @escaping (WithChoice) -> Void) {
        self.group = group
        self._people = State(initialValue: people)
        self.groupsAllowed = groupsAllowed
        self.done = done
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !people.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 8) {
                                ForEach(people) { p in
                                    Chip(text: p.name, symbol: "xmark", on: true) { people.removeAll { $0.id == p.id } }
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                    }
                    PersonSearch(query: $query, placeholder: "Name or email", exclude: Set(people.compactMap(\.userId)), autofocus: true) { pick in
                        if !people.contains(where: { $0.id == pick.id }) { people.append(pick) }
                        query = ""
                    }
                    if people.isEmpty && query.isEmpty && groupsAllowed && !m.flats.isEmpty {
                        SectionLabel("Or one of your groups")
                        VStack(spacing: 0) {
                            ForEach(Array(m.flats.enumerated()), id: \.element.id) { i, f in
                                Button { done(.group(f.id)) } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "person.3.fill").foregroundStyle(.tint).frame(width: 32)
                                        Text(f.name).lineLimit(1)
                                        Spacer()
                                        if f.id == group { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                    }
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(PressStyle())
                                .foregroundStyle(.primary)
                                if i < m.flats.count - 1 { RowDivider(inset: 60) }
                            }
                        }
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                    }
                }
                .padding(16)
            }
            .navigationTitle("With you and")
            .navigationBarTitleDisplayMode(.inline)
            .heimatSurface()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { done(.people(people)) }.disabled(people.isEmpty)
                }
            }
        }
    }
}
