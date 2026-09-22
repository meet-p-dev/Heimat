import SwiftUI

struct ExpenseDraft {
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

    var body: some View {
        let v = Fmt.parse(amount)
        let valid = v > 0 && !among.isEmpty && !payer.isEmpty
        let everyone = among.count == m.members.count
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
                    Picker("Category", selection: $cat) { ForEach(m.cats) { Label($0.label, systemImage: $0.symbol).tag($0.id) } }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Paid by", selection: $payer) { ForEach(m.members) { Text(m.nameOf($0.userId)).tag($0.userId) } }
                } footer: {
                    Button("Edit categories") { m.sheet = .categories }.font(.footnote)
                }
                Section {
                    ForEach(m.members) { mem in
                        let on = among.contains(mem.userId)
                        Button {
                            Haptic.tap()
                            if on { among.remove(mem.userId) } else { among.insert(mem.userId) }
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(name: mem.displayName, seed: mem.userId, size: 30)
                                Text(m.nameOf(mem.userId)).foregroundStyle(.primary)
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
                            among = everyone ? Set([m.uid].compactMap { $0 }) : Set(m.members.map(\.userId))
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
                        let d = ExpenseDraft(desc: desc.trimmingCharacters(in: .whitespaces), amount: v, paidBy: payer,
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
                    amount = Fmt.input(e.amount); desc = e.description ?? ""; payer = e.paidBy
                    among = Set(e.splitAmong); cat = e.category ?? "other"; date = Fmt.date(e.spentOn) ?? Date()
                } else {
                    desc = prefill?.desc ?? ""; cat = prefill?.category ?? "groceries"
                    payer = m.uid ?? ""; among = Set(m.members.map(\.userId))
                }
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
                } else {
                    Section {
                        TextField("e.g. WG Hauptstraße", text: $text)
                    } header: { Text("Flat name") } footer: { Text("You'll get a code to share with your flatmates.") }
                }
            }
            .navigationTitle(mode == .join ? "Join a flat" : "Create a flat")
            .heimatSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton(action: {
                        let ok = mode == .join ? await m.joinFlat(text) : await m.createFlat(text.trimmingCharacters(in: .whitespaces))
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

    var body: some View {
        NavigationStack {
            if let flat = m.flat {
                let msg = "Join my flat “\(flat.name)” on Heimat\nCode: \(flat.joinCode)\nOpen \(Secrets.publicURL) → tap “Join with a code”."
                VStack(spacing: 14) {
                    Text("Code for \(flat.name)").font(.subheadline).foregroundStyle(.secondary)
                    Text(flat.joinCode).font(.system(size: 46, weight: .heavy, design: .rounded)).kerning(6).foregroundStyle(.tint)
                    Text("They open Heimat → Join with a code → type this.").font(.subheadline).foregroundStyle(.secondary)
                    ShareLink(item: msg) { Label("Share invite", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                        .buttonStyle(.glassProminent).controlSize(.large).padding(.top, 8)
                    Button { UIPasteboard.general.string = flat.joinCode; m.show("Code copied") } label: {
                        Label("Copy code", systemImage: "doc.on.doc").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass).controlSize(.large)
                }
                .padding(24)
                .navigationTitle("Invite flatmates")
                .heimatSurface()
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            }
        }
        .presentationDetents([.medium])
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
