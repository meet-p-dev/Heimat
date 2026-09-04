# Shipping Heimat to the App Store and Google Play

Heimat is one codebase: the same Vite/React app runs on the web and inside a
[Capacitor](https://capacitorjs.com) shell on iOS and Android. `ios/` and
`android/` are real, committed native projects — open them in Xcode and Android
Studio like any other app.

```
src/            the app (web + native)
dist/           build output; copied into both shells by `cap sync`
ios/App/        Xcode project — bundle id app.heimat.mobile
android/        Gradle project — applicationId app.heimat.mobile
assets/         1024px icon + 2732px splash sources (generated, see below)
scripts/        make-assets.mjs — draws those sources from the Heimat mark
store/          listing copy and the checklist of store answers
```

## One-time machine setup

| Need | Install |
| --- | --- |
| Node 20+ | already there |
| Xcode 15+ with an iOS simulator | App Store |
| JDK 21 (Gradle does not like newer) | `brew install openjdk@21` |
| Android SDK | Android Studio, or `brew install --cask android-commandlinetools` |

For the command-line Android SDK, point Gradle at it once:

```bash
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > android/local.properties
```

and put JDK 21 on PATH for Gradle:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
```

## Everyday workflow

```bash
npm run sync       # typecheck, build the native bundle, copy it into ios/ and android/
npm run ios        # sync, then open Xcode
npm run android    # sync, then open Android Studio
```

`npm run sync` is the one to remember: nothing you change in `src/` reaches
either app until it runs. `npm run assets` redraws every icon and splash from
`scripts/make-assets.mjs` — only needed if the mark itself changes.

## Before the first submission

### 1. Apple (iOS)

1. Join the Apple Developer Program (99 €/year) — everything below needs it.
2. In Xcode → App target → **Signing & Capabilities**: pick your Team.
   *Automatically manage signing* is fine.
3. The **Push Notifications** capability is already wired up
   (`ios/App/App/App.entitlements`); confirm it shows in the capabilities list.
4. Create an **APNs auth key** at
   developer.apple.com → Certificates, Identifiers & Profiles → Keys → “+”,
   tick *Apple Push Notifications service*. You get a `.p8` file **once** —
   keep it. Note the Key ID and your Team ID.
5. Register the app in App Store Connect with bundle id `app.heimat.mobile`.
6. Archive: Xcode → Product → Destination *Any iOS Device* → **Product → Archive**
   → Distribute App → App Store Connect. `ITSAppUsesNonExemptEncryption` is
   already `false`, so the export-compliance question is skipped.

### 2. Google (Android)

1. Create a Google Play developer account (25 $ once).
2. Create a **Firebase** project, add an Android app with package name
   `app.heimat.mobile`, download `google-services.json` and drop it in
   `android/app/`. Without it the app builds and runs, but Android push stays off.
   (The build detects the file and applies the Google Services plugin itself.)
3. Generate the upload key — **do this once and back it up**; losing it means you
   can never update the listing again:

   ```bash
   keytool -genkeypair -v -keystore android/heimat-upload.jks -alias heimat \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

   Then copy `android/keystore.properties.example` to
   `android/keystore.properties` and fill in the passwords. Both the keystore and
   that file are git-ignored.
4. Build the bundle Play wants:

   ```bash
   npm run android:aab     # android/app/build/outputs/bundle/release/app-release.aab
   ```
5. Upload it to the **Internal testing** track first, install from the tester
   link, then promote to production.

### 3. Server side — push credentials

Both apps get their notifications from the same `push` edge function. It picks a
transport per device from the `endpoint` column: a URL means web push, `apns:`
means the iOS app, `fcm:` means the Android app. Add these rows to `app_config`:

| key | value |
| --- | --- |
| `apns_key_id` | Key ID of the `.p8` |
| `apns_team_id` | your Apple Team ID |
| `apns_private_key` | the whole `.p8` file, `-----BEGIN PRIVATE KEY-----` and all |
| `apns_topic` | `app.heimat.mobile` |
| `apns_env` | `production` for TestFlight/App Store builds, `sandbox` for builds run from Xcode |
| `fcm_service_account` | the service-account JSON from Firebase → Project settings → Service accounts → Generate new private key |

Then redeploy the function:

```bash
npx supabase functions deploy push --project-ref vqvycbzrkeeuuhgrkpbf
```

Web push keeps working unchanged; missing APNs or FCM config only logs a warning
and skips those devices.

### 4. Store listing

Copy, categories, and the answers both stores ask for are in
[store/listing.md](store/listing.md). The two links every listing needs are:

- Privacy policy — `https://meet-p-dev.github.io/Heimat/legal/privacy.html`
- Terms of use — `https://meet-p-dev.github.io/Heimat/legal/terms.html`

Screenshots: run the app in the iOS simulator (iPhone 17 Pro Max for the 6.9"
set) and in an Android emulator, and grab the Home, Flat, Money and Work tabs.

## Releasing an update

1. Bump the version in three places — `package.json`, `MARKETING_VERSION` in
   `ios/App/App.xcodeproj/project.pbxproj`, and `versionName` in
   `android/app/build.gradle`.
2. Bump the build number too: `CURRENT_PROJECT_VERSION` (iOS) and `versionCode`
   (Android) must increase for every upload, even a re-upload of the same version.
3. `npm run sync`, then archive / `npm run android:aab`.

The web build is untouched by all of this and still deploys from
`.github/workflows/deploy.yml` on every push to `main`.
