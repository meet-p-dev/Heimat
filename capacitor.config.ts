import type { CapacitorConfig } from '@capacitor/cli'

/* Native shell around the same Vite build that ships to the web.
   `npm run build:native` writes dist/ without the service worker, then
   `npx cap sync` copies it into ios/ and android/. */
const config: CapacitorConfig = {
  appId: 'app.heimat.mobile',
  appName: 'Heimat',
  webDir: 'dist',
  backgroundColor: '#0c1110',
  ios: {
    // the app draws its own safe-area padding with env(safe-area-inset-*)
    contentInset: 'never',
    backgroundColor: '#0c1110',
  },
  android: {
    backgroundColor: '#0c1110',
    // Supabase + the exchange-rate API are both https; no cleartext needed
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden from the app once React has painted
      backgroundColor: '#0c1110',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
