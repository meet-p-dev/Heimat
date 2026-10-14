import Foundation
import UIKit

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
/// quietly replacing what is on the phone — and switching backup on never
/// overwrites a backup another phone (or an earlier install) made without asking.
@MainActor
final class CloudBackup {
    static let shared = CloudBackup()

    private let store: KVStore
    private var fake = false
    private let payloadKey = "heimat-backup"
    private let stampKey = "heimat-backup-at"
    private let wantKey = "mt-h-icloud-on"
    private let installKey = "mt-h-install-id"

    /// iCloud tells us when a backup arrives or changes — on a fresh install that is a
    /// moment after launch, not straight away. Views listen for this to refresh.
    static let changed = NSUbiquitousKeyValueStore.didChangeExternallyNotification

    private init() {
        #if DEBUG
        // -HeimatFakeCloud: a pretend iCloud on this simulator (kept between launches, like
        // the real one between installs), to look at backup and restore without an Apple ID
        if ProcessInfo.processInfo.arguments.contains("-HeimatFakeCloud") {
            store = UserDefaults(suiteName: "fake-icloud")!
            fake = true
            return
        }
        #endif
        store = NSUbiquitousKeyValueStore.default
    }

    /// Off until asked for: this data has always stayed on the phone, so
    /// sending it anywhere is the user's call to make.
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: wantKey) }
        set { UserDefaults.standard.set(newValue, forKey: wantKey) }
    }

    /// This install, so a backup can tell "made here" from "made on another phone (or before a reinstall)".
    private var installId: String {
        if let id = UserDefaults.standard.string(forKey: installKey) { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: installKey)
        return id
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
        /// which install wrote it, and on what device (both missing in older backups)
        var installId: String?
        var device: String?
    }

    var lastBackup: Date? {
        let t = store.double(forKey: stampKey)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    /// True when iCloud is signed in here. Without it every call here is a silent
    /// no-op, so the UI needs to be able to say so.
    var available: Bool { fake || FileManager.default.ubiquityIdentityToken != nil }

    @discardableResult
    func back(up model: AppModel) -> Bool {
        guard enabled, available else { return false }
        let payload = Payload(savedAt: Date(), profile: model.profile, shifts: model.shifts, prefs: model.prefs,
                              installId: installId, device: UIDevice.current.name)
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

    /// A backup this install didn't make — another phone's, or this phone's before a reinstall.
    /// Switching backup on would overwrite it, so that has to be asked first.
    func foreignBackup() -> Payload? {
        guard let p = peek(), p.installId != installId else { return nil }
        return p
    }

    /// Replaces the personal half on this phone. The caller confirms first. Restoring also
    /// switches backup on here, so the restored data keeps being backed up.
    @discardableResult
    func restore(into model: AppModel) -> Bool {
        guard let p = peek() else { return false }
        model.applyBackup(profile: p.profile, shifts: p.shifts, prefs: p.prefs)
        enabled = true
        back(up: model)
        return true
    }

    /// Stop backing up from this phone. The backup already in iCloud stays (deleteBackup removes it).
    func turnOff() { enabled = false }

    func deleteBackup() {
        enabled = false
        store.removeObject(forKey: payloadKey)
        store.removeObject(forKey: stampKey)
        store.synchronize()
    }

    /// "12 Oct 2026 · Priya · 14 shifts · iPhone", for the restore offers.
    static func summary(_ p: Payload) -> String {
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .none
        var parts = [f.string(from: p.savedAt)]
        if !p.profile.name.isEmpty { parts.append(p.profile.name) }
        parts.append(p.shifts.count == 1 ? "1 shift" : "\(p.shifts.count) shifts")
        if let d = p.device, !d.isEmpty { parts.append(d) }
        return parts.joined(separator: " · ")
    }
}

/// The few calls the backup needs, so a pretend iCloud can stand in on the simulator.
protocol KVStore: AnyObject {
    func data(forKey aKey: String) -> Data?
    func set(_ anObject: Any?, forKey aKey: String)
    func double(forKey aKey: String) -> Double
    func removeObject(forKey aKey: String)
    @discardableResult func synchronize() -> Bool
}
extension NSUbiquitousKeyValueStore: KVStore {}
extension UserDefaults: KVStore {}
