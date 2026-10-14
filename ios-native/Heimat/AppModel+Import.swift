import Foundation
import CryptoKit
import Supabase

/// Bringing a group over from Splitwise (SplitwiseImport.swift reads the file; the server's
/// import_group writes it in one go and checks every balance) — the same as the web app's
/// SplitwiseImportModal.
extension AppModel {
    struct ImportRecord: Decodable, Identifiable, Hashable {
        let id: String
        let flatId: String?
        let expenses: Int
        let payments: Int
        enum CodingKeys: String, CodingKey { case id, expenses, payments, flatId = "flat_id" }
    }

    private struct ImportPayload: Encodable {
        let source = "splitwise"
        let hash: String, name: String, kind: String, me: String
        let people: [SplitwiseImport.Person]
        let expenses: [SplitwiseImport.Expense]
        let payments: [SplitwiseImport.Payment]
        let balances: [String: Int]
    }
    private struct ImportResult: Decodable { let flat: Flat }

    /// a fingerprint of the file (as the web app makes it), so the same file isn't imported twice
    static func importHash(_ text: String) -> String {
        var t = text
        if t.hasPrefix("\u{FEFF}") { t.removeFirst() }
        t = t.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return SHA256.hash(data: Data(t.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// nil when it worked (the new group is open, with the invite sheet); otherwise what went wrong
    func importSplitwise(_ f: SplitwiseImport.File, me: String, name: String, kind: String, text: String) async -> String? {
        if Self.fixtureMode { sheet = nil; show("Demo mode — nothing is imported"); return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = ImportPayload(hash: Self.importHash(text), name: trimmed.isEmpty ? (f.name.isEmpty ? "From Splitwise" : f.name) : trimmed,
                              kind: kind, me: me, people: f.people, expenses: f.expenses, payments: f.payments, balances: f.balances)
        do {
            let r: ImportResult = try await client.rpc("import_group", params: ["p": p]).execute().value
            Haptic.success()
            flatId = r.flat.id
            await loadMyFlats()
            tab = .flat
            groupsPath = [.group(r.flat.id)]
            let others = f.people.count - 1
            sheet = others > 0 ? .invite : nil
            show(others > 0 ? "\(r.flat.name) is here — send everyone their invite link" : "\(r.flat.name) is here")
            return nil
        } catch {
            let msg = "\(error)"
            if msg.contains("import: already") { return "You've already imported this file — it's in your groups." }
            if msg.contains("import: balances_differ") { return "Something didn't add up, so nothing was imported. Nothing has changed." }
            if msg.contains("import: too_many") { return "That's a lot of imports for one day — try again tomorrow." }
            return "Couldn't import — check your connection and try again."
        }
    }

    /// imports whose group is still there (only those can be taken back)
    func myImports() async -> [ImportRecord] {
        guard uid != nil, !Self.fixtureMode else { return [] }
        let rows: [ImportRecord] = (try? await client.from("imports").select("id, flat_id, expenses, payments")
            .order("created_at", ascending: false).execute().value) ?? []
        return rows.filter { $0.flatId != nil }
    }

    /// the group and everything in it, while nobody else has joined
    func removeImport(_ r: ImportRecord) async -> Bool {
        let nm = flats.first { $0.id == r.flatId }?.name ?? "the group"
        do {
            _ = try await client.rpc("remove_import", params: ["p_import": r.id]).execute()
            if flatId == r.flatId { flatId = nil }
            groupsPath = []
            await loadMyFlats()
            show("Removed \(nm)")
            return true
        } catch {
            show("\(error)".contains("someone_joined") ? "Someone has joined that group, so it stays — you can leave it instead" : "Couldn't remove it — try again")
            return false
        }
    }
}
