import Foundation

/// The personal half of Heimat — profile, shifts, settings — kept in
/// the user's own iCloud so a new phone can pick up where the old one left off.
///
/// `NSUbiquitousKeyValueStore` rather than CloudKit: the payload is a few tens
/// of kilobytes, it is the same JSON the export already produces, and the store
/// syncs itself. The 1 MB ceiling is thousands of shifts, far beyond what a
/// student on a 20 h/week limit will ever log.
///
/// This is backup and restore, not live sync. Two phones editing offline would
/// resolve last-writer-wins, so restoring always asks first rather than
/// quietly replacing what is on the phone.
@MainActor
final class CloudBackup {
    static let shared = CloudBackup()

    private let store = NSUbiquitousKeyValueStore.default
    private let payloadKey = "heimat-backup"
    private let stampKey = "heimat-backup-at"
    private let wantKey = "mt-h-icloud-on"

    /// Off until asked for: this data has always stayed on the phone, so
    /// sending it anywhere is the user's call to make.
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: wantKey) }
        set { UserDefaults.standard.set(newValue, forKey: wantKey) }
    }

    /// What a backup holds. Deliberately the same shape as `exportJSON()`, so
    /// a file someone exported by hand could be restored through the same path.
    struct Payload: Codable {
        var app = "Heimat"
        var version = 1
        var savedAt: Date
        var profile: Profile
        var shifts: [Shift]
        var prefs: Prefs
    }

    var lastBackup: Date? {
        let t = store.double(forKey: stampKey)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    /// True when iCloud Drive is actually available to us. Without it every
    /// call here is a silent no-op, so the UI needs to be able to say so.
    var available: Bool { FileManager.default.ubiquityIdentityToken != nil }

    @discardableResult
    func back(up model: AppModel) -> Bool {
        guard enabled, available else { return false }
        let payload = Payload(savedAt: Date(), profile: model.profile,
                              shifts: model.shifts, prefs: model.prefs)
        guard let data = try? JSONEncoder().encode(payload) else { return false }
        // the store caps a value at 1 MB; refuse rather than fail silently
        guard data.count < 900_000 else { return false }
        store.set(data, forKey: payloadKey)
        store.set(Date().timeIntervalSince1970, forKey: stampKey)
        return store.synchronize()
    }

    /// What is in iCloud right now, if anything.
    func peek() -> Payload? {
        store.synchronize()
        guard let data = store.data(forKey: payloadKey) else { return nil }
        return try? JSONDecoder().decode(Payload.self, from: data)
    }

    /// Replaces the personal half on this phone. The caller confirms first.
    func restore(into model: AppModel) -> Bool {
        guard let p = peek() else { return false }
        model.applyBackup(profile: p.profile, shifts: p.shifts, prefs: p.prefs)
        return true
    }

    func turnOff() {
        enabled = false
        store.removeObject(forKey: payloadKey)
        store.removeObject(forKey: stampKey)
        store.synchronize()
    }
}
