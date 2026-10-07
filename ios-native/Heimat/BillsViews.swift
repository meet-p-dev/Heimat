import SwiftUI

// MARK: - Bills (docs/bills-screens.md)

/// A group's bills (flatId) or your own (nil). The ones that need doing come first —
/// overdue, due today, then by date, paid last — each with its due date at a glance and
/// a "Paid" button that says what it does. Tap a bill to change it; Add sits in the header.
struct BillsSection: View {
    @Environment(AppModel.self) private var m
    let flatId: String?

    var body: some View {
        let list = ordered
        VStack(spacing: 0) {
            SectionLabel(text: "Bills") {
                if !list.isEmpty { AddButton { m.sheet = .bill(nil, flatId) }.disabled(m.uid == nil) }
            }
            .padding(.bottom, 10)
            HeimatCard(radius: 22, padding: 0) {
                if list.isEmpty {
                    EmptyPrompt(symbol: "doc.text.fill", tint: Tint.orange,
                                title: flatId == nil ? "Your own bills" : "Shared bills",
                                text: flatId == nil ? "Phone, insurance, gym — you get a reminder on the day each is due."
                                                    : "Rent, electricity, internet — whoever pays gets a reminder on the day.",
                                action: "Add a bill") { m.sheet = .bill(nil, flatId) }
                        .disabled(m.uid == nil)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(list.enumerated()), id: \.element.id) { i, b in
                            BillRowView(bill: b)
                            if i < list.count - 1 { RowDivider(inset: 68) }
                        }
                    }
                }
            }
        }
    }

    /// what needs doing first: overdue, due today, then the next ones by date; paid at the end
    private var ordered: [Bill] {
        let rank = ["overdue": 0, "due": 1, "upcoming": 2, "paid": 3]
        return m.bills(in: flatId).sorted { a, b in
            let sa = m.billStatus[a.id], sb = m.billStatus[b.id]
            return (rank[sa?.state ?? "upcoming"] ?? 2, sa?.dueOn ?? a.anchorOn, a.name)
                 < (rank[sb?.state ?? "upcoming"] ?? 2, sb?.dueOn ?? b.anchorOn, b.name)
        }
    }
}

struct BillRowView: View {
    @Environment(AppModel.self) private var m
    let bill: Bill
    @State private var busy = false
    @State private var confirmUndo = false

    var body: some View {
        let s = m.billStatus[bill.id]
        let line = m.billLine(bill, s)
        let paid = s?.state == "paid"
        HStack(spacing: 12) {
            Button { m.sheet = .bill(bill, bill.flatId) } label: {
                HStack(spacing: 12) {
                    DateBadge(day: s?.dueOn ?? bill.anchorOn, tone: paid ? .done : line.urgent ? .urgent : .calm)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(bill.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                            if let a = bill.amount {
                                Text(Fmt.money(a, bill.currency))
                                    .font(.system(size: 14, weight: .medium)).monospacedDigit().foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        // the badge already says which day, so an overdue bill just says it is overdue
                        Text((s?.state == "overdue" || line.text.hasPrefix("Overdue") ? "Overdue" : line.text) + payerText)
                            .font(.system(size: 12.5))
                            .foregroundStyle(line.urgent ? Color.orange : Color.secondary)
                            .lineLimit(1)
                        if let cb = cancelSoon(s) {
                            Label("Cancel by \(Fmt.relDay(cb)) to end it", systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Color.orange)
                                .labelStyle(TightLabel()).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .foregroundStyle(.primary)

            if let s {
                if paid {
                    // already ticked: a plain mark, and taking it back asks first
                    Button { confirmUndo = true } label: {
                        Label("Paid", systemImage: "checkmark")
                            .font(.system(size: 13, weight: .semibold)).labelStyle(TightLabel())
                            .foregroundStyle(Color.hGreen)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Color.hGreen.opacity(0.14), in: Capsule())
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("\(bill.name) is paid. Tap to mark it not paid")
                } else {
                    Button {
                        guard !busy else { return }
                        Haptic.tap(); busy = true
                        Task { await m.tickBill(bill, due: s.dueOn, paid: true); busy = false }
                    } label: {
                        Text("Mark paid").font(.system(size: 13, weight: .semibold))
                    }
                    .glassButton()
                    .controlSize(.small)
                    .opacity(busy ? 0.5 : 1)
                    .accessibilityLabel("Mark \(bill.name) as paid")
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .confirmationDialog("Mark \(bill.name) as not paid?", isPresented: $confirmUndo, titleVisibility: .visible) {
            Button("Not paid", role: .destructive) {
                guard let on = s?.paidOn else { return }
                Task { await m.tickBill(bill, due: on, paid: false) }
            }
        }
    }

    private var payerText: String {
        guard bill.flatId != nil, let p = bill.payer else { return "" }
        return " · " + (p == m.uid ? "you pay" : "\(m.personName(p)) pays")
    }

    /// the last day to cancel a contract, when it is within two months
    private func cancelSoon(_ s: BillStatus?) -> String? {
        guard let cb = s?.cancelBy, let d = Fmt.date(cb), let t = Fmt.date(Fmt.today()),
              let left = Calendar(identifier: .gregorian).dateComponents([.day], from: t, to: d).day,
              left >= 0, left <= 60 else { return nil }
        return cb
    }
}

/// A day at a glance — "SEP" over "15" — coloured for what it means: orange when it is
/// due or overdue, green once done, quiet otherwise.
struct DateBadge: View {
    enum Tone { case calm, urgent, done }
    let day: String
    var tone: Tone = .calm

    var body: some View {
        let d = Fmt.date(day)
        let color: Color = tone == .urgent ? .orange : tone == .done ? .hGreen : .secondary
        VStack(spacing: 0) {
            Text(d.map { $0.formatted(.dateTime.month(.abbreviated)).uppercased() } ?? "")
                .font(.system(size: 10, weight: .bold)).foregroundStyle(color)
            Text(d.map { $0.formatted(.dateTime.day()) } ?? "–")
                .font(.system(size: 18, weight: .bold)).monospacedDigit()
                .foregroundStyle(tone == .calm ? Color.primary : color)
        }
        .frame(width: 44, height: 44)
        .background(color.opacity(tone == .calm ? 0.10 : 0.15), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// "+ Add" for a section's header
struct AddButton: View {
    var title = "Add"
    let action: () -> Void
    var body: some View {
        Button { Haptic.tap(); action() } label: {
            Label(title, systemImage: "plus").font(.system(size: 13.5, weight: .semibold)).labelStyle(TightLabel())
        }
    }
}

/// what an empty section says, with the one thing to do about it
struct EmptyPrompt: View {
    let symbol: String
    let tint: Color
    let title: String
    let text: String
    let action: String
    let perform: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                SettingIcon(symbol: symbol, color: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .semibold))
                    Text(text).font(.system(size: 12.5)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button { Haptic.tap(); perform() } label: {
                Label(action, systemImage: "plus").frame(maxWidth: .infinity)
            }
            .glassButton()
        }
        .padding(14)
    }
}

/// an icon and its words, close together
struct TightLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) { configuration.icon; configuration.title }
    }
}

/// The Groups tab's card for your own bills.
struct MyBillsCard: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        let list = m.bills(in: nil)
        let next = m.nextBill(in: nil)
        HeimatCard(radius: 24, padding: 16, action: { m.groupsPath = [.myBills] }) {
            HStack(spacing: 12) {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Tint.blue.gradient, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("My bills").font(.system(size: 19, weight: .bold))
                    Text(next.map { "\($0.bill.name): " + m.billLine($0.bill, $0.status).text } ?? (list.isEmpty ? "Phone, insurance, gym — only you see these" : "All paid"))
                        .font(.system(size: 13))
                        .foregroundStyle(next.map { m.billLine($0.bill, $0.status).urgent } == true ? Color.orange : Color.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
    }
}

struct MyBillsView: View {
    @Environment(AppModel.self) private var m

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                BillsSection(flatId: nil)
                Text("Only you see these. On the day one is due you get a reminder; tick it once it's paid.")
                    .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
        }
        .refreshable { await m.loadBills() }
        .navigationTitle("My bills")
        .navigationBarTitleDisplayMode(.inline)
        .heimatScreen()
    }
}

/// Add or edit a bill. In a group it asks who pays (and is reminded); your own are yours.
struct BillForm: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    let editing: Bill?
    let flatId: String?
    @State private var name = ""
    @State private var amount = ""
    @State private var cadence = "monthly"
    @State private var first = Date()
    @State private var payer = ""
    @State private var contract = false
    @State private var ends = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var notice = 1
    @State private var unit = "month"
    @State private var saving = false
    @State private var confirmDelete = false

    private var cur: String { editing?.currency ?? m.hostCur }
    private var people: [Member] { flatId.map { m.members(of: $0).filter { !$0.isPending } } ?? [] }
    private var cancelBy: Date? {
        guard contract else { return nil }
        return Calendar.current.date(byAdding: unit == "week" ? .weekOfYear : .month, value: -notice, to: ends)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(flatId == nil ? "e.g. Phone" : "e.g. Rent", text: $name)
                    HStack {
                        TextField("Amount (optional)", text: $amount).keyboardType(.decimalPad)
                        Text(cur).foregroundStyle(.secondary)
                    }
                } header: { Text("Bill") } footer: { Text("Leave the amount empty if it changes every time.") }
                Section {
                    Picker("How often", selection: $cadence) { ForEach(Bill.cadences, id: \.0) { Text($0.1).tag($0.0) } }
                    DatePicker(editing == nil ? "Next due date" : "First due date", selection: $first, displayedComponents: .date)
                    if flatId != nil {
                        Picker("Who pays", selection: $payer) {
                            Text("Not decided").tag("")
                            ForEach(people) { p in Text(p.userId == m.uid ? "You" : p.displayName).tag(p.userId) }
                        }
                    }
                } footer: {
                    Text(flatId == nil ? "You get a reminder on the day it's due." : "Whoever pays gets a reminder on the day it's due. Everyone sees when it's ticked.")
                }
                Section {
                    Toggle("It's a contract that renews itself", isOn: $contract.animation())
                    if contract {
                        DatePicker("Contract ends", selection: $ends, displayedComponents: .date)
                        Stepper("Notice: \(notice) \(unit == "week" ? (notice == 1 ? "week" : "weeks") : (notice == 1 ? "month" : "months"))", value: $notice, in: 1...24)
                        Picker("Notice in", selection: $unit) { Text("Months").tag("month"); Text("Weeks").tag("week") }.pickerStyle(.segmented)
                        if let cancelBy { LabeledContent("Cancel by", value: cancelBy.formatted(.dateTime.day().month(.wide).year())) }
                    }
                } footer: {
                    if contract { Text("We remind you four weeks and one week before the last day to cancel.") }
                    else { Text("Internet, phone or gym contracts often renew unless you cancel in time.") }
                }
                if editing != nil {
                    Section { Button("Remove bill", role: .destructive) { confirmDelete = true } }
                }
            }
            .navigationTitle(editing == nil ? "New bill" : "Edit bill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving || m.uid == nil)
                }
            }
            .confirmationDialog("Remove \(editing?.name ?? "this bill")? Its ticks go with it.", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { if let b = editing { Task { await m.deleteBill(b); dismiss() } } }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let b = editing else {
            if flatId != nil { payer = m.uid ?? "" }
            return
        }
        name = b.name
        amount = b.amount.map { Fmt.input($0) } ?? ""
        cadence = b.cadence
        first = Fmt.date(b.anchorOn) ?? Date()
        payer = b.payer ?? ""
        if let e = b.contractEndsOn, let d = Fmt.date(e) {
            contract = true; ends = d; notice = b.noticeAmount ?? 1; unit = b.noticeUnit ?? "month"
        }
    }

    private func save() {
        saving = true
        let a = amount.trimmingCharacters(in: .whitespaces)
        let row = AppModel.BillRow(
            flat_id: flatId, owner_id: flatId == nil ? m.uid : nil,
            name: name.trimmingCharacters(in: .whitespaces), amount: a.isEmpty ? nil : Fmt.amount(a, cur),
            currency: cur, category: editing?.category ?? "bills", cadence: cadence, anchor_on: Fmt.ymd(first),
            payer: flatId == nil ? m.uid : (payer.isEmpty ? nil : payer),
            contract_ends_on: contract ? Fmt.ymd(ends) : nil, notice_amount: contract ? notice : nil, notice_unit: contract ? unit : nil)
        Task {
            if await m.saveBill(id: editing?.id, row) { dismiss() }
            saving = false
        }
    }
}
