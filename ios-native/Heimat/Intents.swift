import AppIntents
import Foundation
import Supabase

/// The categories Siri and the Shortcuts app can offer. Built-ins only: a
/// flat's custom categories live in the database and are not known to the
/// system at the time it builds its phrase list.
enum ExpenseCategory: String, AppEnum {
    case groceries, rent, utilities, internet, eatout, transport, household, other

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Category" }
    static var caseDisplayRepresentations: [ExpenseCategory: DisplayRepresentation] = [
        .groceries: "Groceries",
        .rent: "Rent",
        .utilities: "Utilities",
        .internet: "Internet",
        .eatout: "Eating out",
        .transport: "Transport",
        .household: "Household",
        .other: "Other",
    ]
}

/// The work an intent does, away from any view.
///
/// An intent can be run while Heimat is not on screen, so it cannot reach
/// `AppModel`. It builds its own client against the same auth storage key,
/// which means it picks up the session the app already signed in with.
enum IntentStore {
    static func client() -> SupabaseClient {
        SupabaseClient(
            supabaseURL: URL(string: Secrets.supabaseURL)!,
            supabaseKey: Secrets.supabaseKey,
            options: SupabaseClientOptions(auth: .init(storageKey: "heimat-auth", emitLocalSessionAsInitialSession: true))
        )
    }

    static var flatId: String? { UserDefaults.standard.string(forKey: "flatId") }

    static var profile: Profile {
        UserDefaults.standard.data(forKey: "profile")
            .flatMap { try? JSONDecoder().decode(Profile.self, from: $0) } ?? Profile()
    }

    static func saveShifts(_ shifts: [Shift]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(shifts), forKey: "shifts")
    }

    static var shifts: [Shift] {
        UserDefaults.standard.data(forKey: "shifts")
            .flatMap { try? JSONDecoder().decode([Shift].self, from: $0) } ?? []
    }
}

/// "Add an expense to Heimat."
struct AddExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Add an expense"
    static var description = IntentDescription("Splits a new expense with your flat.")
    /// The work happens in the background — no reason to make you look at the app.
    static var openAppWhenRun = false

    @Parameter(title: "Amount", requestValueDialog: "How much?")
    var amount: Double

    @Parameter(title: "Category", default: .groceries)
    var category: ExpenseCategory

    @Parameter(title: "What for?", requestValueDialog: "What was it for?")
    var note: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$amount) for \(\.$category) to Heimat") { \.$note }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard amount > 0 else {
            return .result(dialog: "That amount doesn't look right.")
        }
        guard let flatId = IntentStore.flatId else {
            return .result(dialog: "You're not in a flat yet, so there's nobody to split with.")
        }

        let client = IntentStore.client()
        guard let uid = try? await client.auth.session.user.id.uuidString else {
            return .result(dialog: "Open Heimat and sign in first.")
        }

        // split with everyone in the flat, which is what the app does by default
        struct MemberRow: Decodable { let user_id: String }
        let members: [MemberRow] = (try? await client.from("flat_members")
            .select("user_id").eq("flat_id", value: flatId).execute().value) ?? []
        let among = members.map(\.user_id)
        guard !among.isEmpty else {
            return .result(dialog: "Couldn't read your flat. Open Heimat once and try again.")
        }

        let profile = IntentStore.profile
        struct NewExpense: Encodable {
            let flat_id: String, description: String, amount: Double, currency: String
            let paid_by: String, split_among: [String], category: String
            let created_by: String, spent_on: String
        }
        let label = ExpenseCategory.caseDisplayRepresentations[category]?.title ?? "Expense"
        try await client.from("expenses").insert(NewExpense(
            flat_id: flatId,
            description: note?.trimmingCharacters(in: .whitespaces) ?? "",
            amount: amount,
            currency: profile.hostCur,
            paid_by: uid,
            split_among: among,
            category: category.rawValue,
            created_by: uid,
            spent_on: Fmt.today()
        )).execute()

        let money = Fmt.money(amount, profile.hostCur)
        return .result(dialog: "Added \(money) for \(String(localized: label)).")
    }
}

/// "Log a shift in Heimat." Shifts are personal, so this never leaves the phone.
struct LogShiftIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a work shift"
    static var description = IntentDescription("Records hours worked, on this phone.")
    static var openAppWhenRun = false

    @Parameter(title: "Hours", requestValueDialog: "How many hours?")
    var hours: Double

    @Parameter(title: "Employer")
    var employer: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$hours) hours in Heimat") { \.$employer }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard hours > 0, hours <= 24 else {
            return .result(dialog: "That doesn't look like a shift length.")
        }
        let existing = await Router.shared.model?.shifts ?? IntentStore.shifts
        var shift = Shift()
        shift.date = Fmt.today()
        shift.employer = employer?.trimmingCharacters(in: .whitespaces) ?? ""
        shift.hours = hours
        // carry the last wage forward, so pay is right without being asked
        shift.wage = existing.sorted { $0.date < $1.date }.last?.wage ?? 0

        // When Heimat is running it owns this array in memory and rewrites the
        // whole thing on any change, so go through it rather than behind it.
        let logged = shift
        if let model = await Router.shared.model {
            await MainActor.run { model.saveShift(logged) }
        } else {
            IntentStore.saveShifts(existing + [logged])
        }
        return .result(dialog: "Logged \(Fmt.num(hours)) hours.")
    }
}

/// Opens Heimat on the new-expense sheet — what a widget button will run.
struct OpenAddExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Open new expense"
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        await MainActor.run { Router.shared.pending = .addExpense }
        return .result()
    }
}

/// Where an intent asks the running app to go.
@MainActor
final class Router {
    static let shared = Router()
    enum Destination { case addExpense }
    var pending: Destination?
    /// Set while Heimat is on screen, so an intent can go through the running
    /// app instead of writing behind its back.
    weak var model: AppModel?
}

/// The phrases Siri knows without the user setting anything up.
struct HeimatShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddExpenseIntent(),
            phrases: [
                "Add an expense to \(.applicationName)",
                "Split an expense in \(.applicationName)",
                "New expense in \(.applicationName)",
            ],
            shortTitle: "Add expense",
            systemImageName: "plus.circle.fill"
        )
        AppShortcut(
            intent: LogShiftIntent(),
            phrases: [
                "Log a shift in \(.applicationName)",
                "Log work hours in \(.applicationName)",
            ],
            shortTitle: "Log shift",
            systemImageName: "clock.fill"
        )
    }
}
