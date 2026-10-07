import SwiftUI
import UserNotifications
import UIKit
import Supabase

/// Remote notifications.
///
/// The server half is shared with the web build: the `push` edge function
/// sends through APNs for any subscription whose `endpoint` starts with
/// `apns:` (or `apns-dev:`), and database triggers call it. So all this side
/// has to do is get a device token and keep that row filed under whoever is
/// signed in on this phone.
///
/// Turning notifications off in the app cannot revoke the OS permission, so —
/// as on the web — we remember the answer and simply stop registering.
@MainActor
final class Push: NSObject, ObservableObject {
    static let shared = Push()

    private let wantKey = "mt-h-push-on"
    /// Set once iOS has asked, so Home's "Turn on" card doesn't come back.
    static let askedKey = "mt-h-push-asked"
    /// The user's own answer, which outlives a permission we cannot revoke.
    var wanted: Bool {
        get { UserDefaults.standard.object(forKey: wantKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: wantKey) }
    }

    @ObservationIgnored weak var model: AppModel?
    /// Set once the app is told of a token, so a later sign-in can re-save it.
    private var token: String?

    /// A build run from Xcode gets a token for Apple's sandbox; TestFlight and
    /// the App Store get production ones (see APS_ENVIRONMENT in project.yml).
    /// The two only work against their own APNs host, so the row says which.
    #if DEBUG
    private let prefix = "apns-dev:"
    #else
    private let prefix = "apns:"
    #endif

    /// Claim the notification centre so foreground pushes are shown and taps
    /// come back to us. Without this iOS silently drops a banner while the app
    /// is open, which looks exactly like a push that never arrived.
    func takeDelegate() {
        UNUserNotificationCenter.current().delegate = self
    }

    func permission() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Ask, register, and store. Returns nil on success or a reason to show.
    @discardableResult
    func enable() async -> String? {
        // iOS only ever shows its prompt once, so neither must Home's card
        UserDefaults.standard.set(true, forKey: Self.askedKey)
        let centre = UNUserNotificationCenter.current()
        let granted = (try? await centre.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return "denied" }
        wanted = true
        UIApplication.shared.registerForRemoteNotifications()
        return nil
    }

    func disable() {
        wanted = false
        UIApplication.shared.unregisterForRemoteNotifications()
        // and tell the server, rather than waiting for APNs to report it gone
        forgetting = Task { await forget() }
    }

    /// A forget still on its way; a save waits for it, so switching straight
    /// back on can't have its fresh row deleted by the "off" that came before.
    private var forgetting: Task<Void, Never>?

    /// Re-register on every launch: APNs tokens rotate.
    func refresh() async {
        guard wanted, await permission() == .authorized else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Pushes no longer set a badge, but older ones left a "1" that nothing
    /// cleared; opening the app counts as having seen them.
    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0) { _ in }
    }

    /// Called by the app delegate once APNs hands over a token. Before anyone
    /// is signed in it is only kept; `resaveAfterAuth` saves it once there is.
    func store(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task { await save(hex) }
    }

    /// Through `save_push_device` rather than a plain upsert: the endpoint is
    /// unique, and a row left under the guest account this phone started as
    /// can only be moved to the account signed in now by the database itself.
    @discardableResult
    private func save(_ hex: String) async -> Bool {
        #if DEBUG
        if AppModel.fixtureMode { return false }
        #endif
        await forgetting?.value
        guard let m = model, m.uid != nil else { return false }
        do {
            _ = try await m.client.rpc("save_push_device", params: ["p_endpoint": prefix + hex, "p_platform": "ios"]).execute()
            #if DEBUG
            // builds before 'apns-dev:' saved this same Xcode token as 'apns:', which the
            // server still delivers (via its retry on Apple's other server) — so without
            // this, a phone running from Xcode gets every notification twice
            _ = try? await m.client.rpc("forget_push_device", params: ["p_endpoint": "apns:" + hex]).execute()
            #endif
            return true
        } catch {
            print("push: could not save subscription —", error.localizedDescription)
            return false
        }
    }

    /// After a sign-in the token we already hold belongs to a new user.
    func resaveAfterAuth() {
        guard wanted, let hex = token else { return }
        Task { await save(hex) }
    }

    /// Before signing out or switching off: this phone stops getting the
    /// account's notifications. Only ever removes this phone's own row.
    func forget() async {
        #if DEBUG
        if AppModel.fixtureMode { return }
        #endif
        guard let m = model, m.uid != nil, let hex = token else { return }
        do {
            _ = try await m.client.rpc("forget_push_device", params: ["p_endpoint": prefix + hex]).execute()
        } catch {
            print("push: could not forget this device —", error.localizedDescription)
        }
    }

    // MARK: test

    /// What the `push` function answers to `{ event: "test" }`: whether each
    /// transport has its keys on the server, and how each of your devices fared.
    private struct TestReply: Decodable {
        struct Configured: Decodable { let apns: Bool; let fcm: Bool; let web: Bool }
        struct Device: Decodable { let platform: String; let ok: Bool; let reason: String? }
        let configured: Configured
        let devices: [Device]
        let sent: Int
    }

    static let notRegistered = "This device isn't registered yet. Turn notifications on, then try again."

    /// Settings' "Send a test notification": sends one to your own devices and
    /// says in plain words what happened on this one.
    func sendTest() async -> String {
        #if DEBUG
        if AppModel.fixtureMode { return "Demo mode — nothing is sent" }
        #endif
        if token == nil {
            // no token from Apple yet — just switched on, or it failed: ask again and
            // give Apple a moment, rather than say "not registered" with the switch on
            await refresh()
            for _ in 0..<12 where token == nil { try? await Task.sleep(for: .milliseconds(250)) }
        }
        guard let m = model, m.uid != nil, let hex = token else { return Self.notRegistered }
        // file this phone under the account signed in now, so the test finds it
        await save(hex)
        do {
            let r: TestReply = try await m.client.functions.invoke("push", options: FunctionInvokeOptions(body: ["event": "test"]))
            let mine = r.devices.filter { $0.platform == "ios" }
            if mine.isEmpty { return Self.notRegistered }
            if !r.configured.apns { return "Notifications for iPhone aren't switched on on the server yet." }
            if mine.contains(where: \.ok) { return "Sent. It should appear in a few seconds." }
            return "Couldn't deliver it: " + (mine.compactMap(\.reason).first ?? "the server didn't say why.")
        } catch let e as URLError where e.code != .cancelled {
            return "Couldn't deliver it: can't reach the server. Check your connection and try again."
        } catch {
            return "Couldn't deliver it: the server didn't answer as expected. Try again in a minute."
        }
    }
}

extension Push: UNUserNotificationCenterDelegate {
    /// Show the banner even with Heimat open — a flatmate's expense is worth
    /// seeing whichever tab you are on.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // reload alongside, not first: the banner (a test one from Settings
        // included) shouldn't wait for every group to load over the network
        let isUpdate = notification.request.content.userInfo["url"] != nil
        Task { @MainActor in
            if isUpdate { await Push.shared.model?.checkUpdate() } else { await Push.shared.model?.reload() }
        }
        return [.banner, .sound, .list]
    }

    /// Tapped from the tray: bring the user to fresh data — or, for "New update
    /// available", straight to TestFlight (the notification carries where).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        if let link = response.notification.request.content.userInfo["url"] as? String {
            await MainActor.run { AppModel.openUpdate(link) }
            await Push.shared.model?.checkUpdate()
            return
        }
        await Push.shared.model?.reload()
    }
}

/// UIKit still owns the APNs callbacks, so the app keeps a delegate for them.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in Push.shared.store(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("push: registration failed —", error.localizedDescription)
    }

    /// A push means something in the flat changed, so pull fresh data. The
    /// payload itself is not Sendable, so nothing from it crosses to the main
    /// actor — we only use the push as a signal to reload.
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task { @MainActor in
            await Push.shared.model?.reload()
            completionHandler(.newData)
        }
    }
}
