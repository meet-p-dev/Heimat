import SwiftUI
import UserNotifications
import UIKit

/// Remote notifications.
///
/// The server half already exists and is shared with the web build: the
/// `push` edge function sends through APNs for any subscription whose
/// `endpoint` starts with `apns:`, and database triggers call it. So all this
/// side has to do is get a device token and keep that row up to date.
///
/// Turning notifications off in the app cannot revoke the OS permission, so —
/// as on the web — we remember the answer and simply stop registering.
@MainActor
final class Push: NSObject, ObservableObject {
    static let shared = Push()

    private let wantKey = "mt-h-push-on"
    /// The user's own answer, which outlives a permission we cannot revoke.
    var wanted: Bool {
        get { UserDefaults.standard.object(forKey: wantKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: wantKey) }
    }

    @ObservationIgnored weak var model: AppModel?
    /// Set once the app is told of a token, so a later sign-in can re-save it.
    private var token: String?

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
    }

    /// Re-register on every launch: APNs tokens rotate.
    func refresh() async {
        guard wanted, await permission() == .authorized else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Called by the app delegate once APNs hands over a token.
    func store(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task { await save(hex) }
    }

    /// The row shape both transports share — `endpoint` is the unique key, so a
    /// rotated token simply inserts and the old one ages out via APNs' "gone".
    private func save(_ hex: String) async {
        guard let m = model, m.uid != nil else { return }
        struct Row: Encodable { let endpoint: String; let platform: String }
        let row = Row(endpoint: "apns:" + hex, platform: "ios")
        do {
            try await m.client.from("push_subscriptions").upsert(row, onConflict: "endpoint").execute()
        } catch {
            print("push: could not save subscription —", error.localizedDescription)
        }
    }

    /// After a sign-in the token we already hold belongs to a new user.
    func resaveAfterAuth() {
        guard wanted, let hex = token else { return }
        Task { await save(hex) }
    }
}

extension Push: UNUserNotificationCenterDelegate {
    /// Show the banner even with Heimat open — a flatmate's expense is worth
    /// seeing whichever tab you are on.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await Push.shared.model?.reload()
        return [.banner, .sound, .list]
    }

    /// Tapped from the tray: bring the user to fresh data.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
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
