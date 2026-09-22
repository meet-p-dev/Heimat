import Foundation
import WebKit

/// One-time hand-over from the Capacitor build this app replaces.
///
/// That app kept everything in its web view's localStorage, under the origin
/// capacitor://localhost: the Supabase session ("heimat-auth"), the profile,
/// shifts and the chosen flat. The native app ships under the same bundle
/// id, so it inherits the same website data store — a throwaway WKWebView on that
/// origin can still read it. Without this, a guest (anonymous) user would start as
/// a brand-new person on first launch and lose their place in the flat.
@MainActor
final class LegacyImport: NSObject, WKNavigationDelegate, WKURLSchemeHandler {
    struct Result {
        var profile: Profile?
        var shifts: [Shift]?
        var prefs: Prefs?
        var flatId: String?
        var accessToken: String?
        var refreshToken: String?
    }

    static let doneKey = "legacyImportDone"
    private var web: WKWebView?
    private var cont: CheckedContinuation<[String: String], Never>?

    /// nil once it has run, or when there was nothing to import
    static func run() async -> Result? {
        guard !UserDefaults.standard.bool(forKey: doneKey) else { return nil }
        let raw = await LegacyImport().read()
        UserDefaults.standard.set(true, forKey: doneKey)
        guard !raw.isEmpty else { return nil }

        func decode<T: Decodable>(_ key: String, _ t: T.Type) -> T? {
            guard let s = raw[key], s != "null" else { return nil }
            return try? JSONDecoder().decode(T.self, from: Data(s.utf8))
        }
        var r = Result()
        r.profile = decode("mt-h-profile", Profile.self)
        r.shifts = decode("mt-h-shifts", [Shift].self)
        r.prefs = decode("mt-h-prefs", Prefs.self)
        r.flatId = decode("mt-h-flatid", String.self)
        struct Session: Decodable { let access_token: String; let refresh_token: String }
        if let s = decode("heimat-auth", Session.self) {
            r.accessToken = s.access_token
            r.refreshToken = s.refresh_token
        }
        return r
    }

    private func read() async -> [String: String] {
        await withCheckedContinuation { c in
            cont = c
            let cfg = WKWebViewConfiguration()
            cfg.setURLSchemeHandler(self, forURLScheme: "capacitor")
            let w = WKWebView(frame: .zero, configuration: cfg)
            w.navigationDelegate = self
            web = w
            w.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
            // never hold up launch on this
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.finish([:]) }
        }
    }

    private func finish(_ d: [String: String]) {
        cont?.resume(returning: d)
        cont = nil
        web = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let js = "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))"
        webView.evaluateJavaScript(js) { [weak self] value, _ in
            let dict = (value as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: String] } ?? [:]
            self?.finish(dict)
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish([:]) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish([:]) }

    // an empty page, so the capacitor://localhost origin exists to read from
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let data = Data("<!doctype html><title>Heimat</title>".utf8)
        task.didReceive(URLResponse(url: task.request.url!, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
