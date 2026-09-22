import SwiftUI

/// Sign up, sign in, forgotten password, change password, change email.
/// Signing up attaches an email and password to the current (guest) user, so the
/// user id — and with it the flat and every expense — stays the same.
struct AuthView: View {
    @Environment(AppModel.self) private var m
    @Environment(\.dismiss) private var dismiss
    @State private var mode: AuthMode
    @State private var name = ""
    @State private var mail = ""
    @State private var pw = ""
    @State private var err: String?
    @State private var sent = false
    @State private var working = false

    init(start: AuthMode) { _mode = State(initialValue: start) }

    private var newPw: Bool { mode == .signup || mode == .password }
    private var mailOK: Bool { mail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil }
    private var valid: Bool {
        switch mode {
        case .signup: !name.trimmingCharacters(in: .whitespaces).isEmpty && mailOK && pw.count >= 8
        case .signin: mailOK && !pw.isEmpty
        case .forgot: mailOK
        case .email: mailOK && mail.lowercased() != (m.email ?? "").lowercased()
        case .password: pw.count >= 8
        }
    }
    private var title: String {
        switch mode {
        case .signup: "Create your account"
        case .signin: "Welcome back"
        case .forgot: "Reset your password"
        case .password: "Change password"
        case .email: "Change email"
        }
    }
    private var sub: String {
        switch mode {
        case .signup: "Your flat, balances and history — backed up, and back on any phone you sign in on."
        case .signin: "Sign in to get your flat and balances back on this phone."
        case .forgot: "Enter the email you signed up with and we'll send a link to choose a new password."
        case .password: "Signed in as \(m.email ?? "your account"). Choose a new password — at least 8 characters."
        case .email: "Currently \(m.email ?? "no email"). We'll send a link to the new address; the change happens once you open it."
        }
    }
    private var symbol: String {
        switch mode {
        case .signup: "person.crop.circle.badge.plus"
        case .signin: "person.crop.circle"
        case .forgot: "key.fill"
        case .password: "lock.fill"
        case .email: "envelope.fill"
        }
    }
    private var cta: String {
        switch mode {
        case .signup: "Create account"
        case .signin: "Sign in"
        case .forgot: "Send reset link"
        case .password: "Update password"
        case .email: "Send confirmation link"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: sent ? "envelope.badge.fill" : symbol)
                            .font(.system(size: 28, weight: .semibold)).foregroundStyle(.tint)
                            .frame(width: 62, height: 62)
                            .glassEffect(.regular, in: .rect(cornerRadius: 20))
                        Text(sent ? (mode == .forgot ? "Check your inbox" : "Confirm your new email") : title)
                            .font(.largeTitle.bold())
                        Text(sent
                             ? (mode == .forgot
                                ? "If an account exists for \(mail), a reset link is on its way. Open it, choose a new password, then come back and sign in."
                                : "Open the link we sent to \(mail). Until then, keep signing in with \(m.email ?? "your current email").")
                             : sub)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

                if sent {
                    Section {
                        if mode == .forgot { Button("Back to sign in") { mode = .signin } }
                        AsyncButton(action: submit) { Text("Resend email") }
                    } footer: { Text("Nothing after a few minutes? Check your spam folder.") }
                } else {
                    if mode == .signin && m.isAnon && m.flat != nil {
                        Section {
                            Label("You're in a flat as a guest. Signing in to another account leaves this guest session behind — create an account instead to keep it.", systemImage: "exclamationmark.shield.fill")
                                .font(.subheadline).foregroundStyle(.orange)
                        }
                    }
                    Section {
                        if mode == .signup {
                            TextField("Name", text: $name).textContentType(.givenName)
                        }
                        if mode != .password {
                            TextField(mode == .email ? "New email" : "Email", text: $mail)
                                .textContentType(mode == .signin ? .username : .emailAddress)
                                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        }
                        if mode == .signup || mode == .signin || mode == .password {
                            SecureField(newPw ? "Password (at least 8 characters)" : "Password", text: $pw)
                                .textContentType(newPw ? .newPassword : .password)
                                .onSubmit { Task { await submit() } }
                        }
                    } footer: {
                        if newPw && !pw.isEmpty { strength }
                    }
                    if let err {
                        Section { Label(err, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.subheadline) }
                    }
                    Section {
                        Button { Task { await submit() } } label: {
                            HStack { Spacer(); if working { ProgressView() } else { Text(cta).bold() }; Spacer() }
                        }
                        .disabled(!valid || working)
                    }
                    Section {
                        switch mode {
                        case .signin:
                            Button("Forgot password?") { mode = .forgot }
                            if m.isAnon { Button("New to Heimat? Create an account") { mode = .signup } }
                        case .signup:
                            Button("Already have an account? Sign in") { mode = .signin }
                        case .forgot:
                            Button("Remembered it? Back to sign in") { mode = .signin }
                        default: EmptyView()
                        }
                    } footer: {
                        if mode == .signup {
                            Text("By creating an account you agree to the [Terms](\(Secrets.publicURL)legal/terms.html) and [Privacy policy](\(Secrets.publicURL)legal/privacy.html). Your shifts stay on this phone — they aren't part of the account.")
                        }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .heimatSurface()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
                }
            }
            .onChange(of: mode) { pw = ""; err = nil; sent = false }
            .onAppear { if name.isEmpty { name = m.profile.name } }
        }
    }

    private var strength: some View {
        let s = score(pw)
        let colors: [Color] = [.red, .orange, .green, .green]
        return HStack(spacing: 6) {
            ForEach(1...3, id: \.self) { i in
                Capsule().fill(s >= i ? colors[s] : Color.secondary.opacity(0.25)).frame(height: 4)
            }
            Text(["Too short", "Okay", "Good", "Strong"][s]).font(.caption.weight(.semibold)).foregroundStyle(colors[s])
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.top, 4)
    }

    private func score(_ p: String) -> Int {
        guard p.count >= 8 else { return 0 }
        var s = 0
        if p.count >= 12 { s += 1 }
        if p.rangeOfCharacter(from: .lowercaseLetters) != nil && p.rangeOfCharacter(from: .uppercaseLetters) != nil { s += 1 }
        if p.rangeOfCharacter(from: .decimalDigits) != nil { s += 1 }
        if p.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil { s += 1 }
        return s <= 1 ? 1 : s == 2 ? 2 : 3
    }

    private func submit() async {
        guard valid, !working else { return }
        working = true; err = nil
        let e: String?
        switch mode {
        case .signup: e = await m.signUp(name: name.trimmingCharacters(in: .whitespaces), email: mail.trimmingCharacters(in: .whitespaces), password: pw)
        case .signin: e = await m.signIn(email: mail.trimmingCharacters(in: .whitespaces), password: pw)
        case .forgot: e = await m.sendReset(mail.trimmingCharacters(in: .whitespaces))
        case .email: e = await m.changeEmail(mail.trimmingCharacters(in: .whitespaces))
        case .password: e = await m.setPassword(pw)
        }
        working = false
        if let e { err = e; return }
        if mode == .forgot || mode == .email { sent = true } else { dismiss() }
    }
}
