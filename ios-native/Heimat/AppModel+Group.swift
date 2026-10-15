import Foundation
import Supabase

/// Group settings ("⋯" on a group's card): renaming it and saying what it's for, renaming
/// people who haven't joined, deleting a group — the server's update_group, rename_member
/// and delete_group (migration 20261017000000_group_settings).
extension AppModel {
    /// nil when it worked; otherwise what to say
    func updateGroup(_ id: String, name: String, purpose: String) async -> String? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return "Give the group a name" }
        if Self.fixtureMode {
            if let i = flats.firstIndex(where: { $0.id == id }) { flats[i].name = n; flats[i].purpose = purpose }
            return nil
        }
        struct P: Encodable { let p_flat: String, p_name: String, p_purpose: String }
        do {
            let f: Flat = try await client.rpc("update_group", params: P(p_flat: id, p_name: n, p_purpose: purpose)).execute().value
            if let i = flats.firstIndex(where: { $0.id == id }) { flats[i].name = f.name; flats[i].purpose = f.purpose }
            Haptic.success()
            return nil
        } catch {
            return raised(error) ?? friendly(error, "Couldn't save that. Try again.")
        }
    }

    /// your own name in this group, or the name of someone who hasn't joined yet
    func renameMember(_ member: Member, to name: String) async -> String? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return "Enter a name" }
        if Self.fixtureMode {
            if let i = members.firstIndex(where: { $0.id == member.id }) { members[i].displayName = n }
            return nil
        }
        struct P: Encodable { let p_flat: String, p_uid: String, p_name: String }
        do {
            _ = try await client.rpc("rename_member", params: P(p_flat: member.flatId, p_uid: member.userId, p_name: n)).execute()
            Haptic.success()
            await loadFlat()
            return nil
        } catch {
            if "\(error)".contains("only they can") { return "Only they can change the name they go by." }
            return raised(error) ?? friendly(error, "Couldn't rename them. Try again.")
        }
    }

    /// the group and everything in it — the server refuses while money is owed and someone
    /// else has joined
    func deleteGroup(_ id: String) async {
        if Self.fixtureMode { show("Demo mode — nothing is deleted"); return }
        do {
            _ = try await client.rpc("delete_group", params: ["p_flat": id]).execute()
            Haptic.success()
            groupsPath = []
            flatId = nil
            await loadMyFlats()
            show("Group deleted")
        } catch {
            show("\(error)".contains("not_settled") || "\(error)".contains("settle up") ? "Everyone has to be settled up first" : friendly(error, "Couldn't delete it. Try again."))
        }
    }
}
