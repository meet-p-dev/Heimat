import SwiftUI

// MARK: - Bills (docs/bills-screens.md)

/// A group's bills (flatId) or your own (nil): one row each with a tick circle for
/// the due date it is at, and Add bill. Tapping the row edits the bill.
struct BillsSection: View {
    @Environment(AppModel.self) private var m
    let flatId: String?

    var body: some View {
        let list = m.bills(in: flatId)
        VStack(alignment: .leading, spacing: 8) {
            Text("Bills").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).padding(.leading, 4)
            HeimatCard(radius: 22, padding: 0) {
                VStack(spacing: 0) {
                    ForEach(list) { b in
                        BillRowView(bill: b)
                        RowDivider(inset: 56)
                    }
                    Button { m.sheet = .bill(nil, flatId) } label: {
                        Label(list.isEmpty ? (flatId == nil ? "Add your phone, insurance or gym" : "Add rent, electricity or internet") : "Add bill",
                              systemImage: "plus.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 14)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    .disabled(m.uid == nil)
                }
            }
        }
    }
}

struct BillRowView: View {
    @Environment(AppModel.self) private var m
    let bill: Bill
    @State private var busy = false

    var body: some View {
        let s = m.billStatus[bill.id]
        let line = m.billLine(bill, s)
        let paid = s?.state == "paid"
        HStack(spacing: 12) {
            Button {
                guard let s, !busy else { return }
                Haptic.tap()
                busy = true
                Task {
                    // ticked: take back the latest tick; otherwise tick the date it is at
                    if paid, let on = s.paidOn { await m.tickBill(bill, due: on, paid: false) }
                    else { await m.tickBill(bill, due: s.dueOn, paid: true) }
                    busy = false
                }
            } label: {
                Image(systemName: paid ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 26, weight: .regular))
                    .foregroundStyle(paid ? AnyShapeStyle(Color.hGreen) : line.urgent ? AnyShapeStyle(Color.orange) : AnyShapeStyle(.tertiary))
                    .frame(width: 30, height: 30)
                    .opacity(busy ? 0.4 : 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(paid ? "Paid — tap to undo" : "Mark \(bill.name) as paid")

            Button { m.sheet = .bill(bill, bill.flatId) } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bill.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        Text(line.text + payerText)
                            .font(.system(size: 12.5))
                            .foregroundStyle(line.urgent ? Color.orange : Color.secondary)
                            .lineLimit(1)
                        if let cb = s?.cancelBy, let d = Fmt.date(cb), let t = Fmt.date(Fmt.today()),
                           let left = Calendar(identifier: .gregorian).dateComponents([.day], from: t, to: d).day, left >= 0, left <= 60 {
                            Text("Cancel by \(Fmt.relDay(cb)) if you want to end it")
                                .font(.system(size: 12)).foregroundStyle(Color.orange).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                    if let a = bill.amount { Text(Fmt.money(a, bill.currency)).font(.system(size: 15, weight: .semibold)).monospacedDigit() }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .foregroundStyle(.primary)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private var payerText: String {
        guard bill.flatId != nil, let p = bill.payer else { return "" }
        return " · " + (p == m.uid ? "you pay" : "\(m.personName(p)) pays")
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
                } footer: { Text("Leave the amount empty if it changes every time.") }
                Section {
                    Picker("How often", selection: $cadence) { ForEach(Bill.cadences, id: \.0) { Text($0.1).tag($0.0) } }
                    DatePicker(editing == nil ? "Next due" : "First due", selection: $first, displayedComponents: .date)
                    if flatId != nil {
                        Picker("Who pays", selection: $payer) {
                            Text("Nobody set").tag("")
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
