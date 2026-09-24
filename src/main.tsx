import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import 'flag-icons/css/flag-icons.min.css'
import './index.css'
import App from './App'
import { initNative } from './lib/native'
import { loadPrefs, resolveDark, applyThemeToDocument } from './lib/prefs'

// theme and status bar before the first paint, so neither the page nor the
// native shell flashes the wrong colour on launch
const prefs = loadPrefs()
const dark = resolveDark(prefs)
applyThemeToDocument(dark, prefs.reduceGlass)
initNative(dark)

// only the app registers the service worker; reset.html deliberately does not
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(<App />)
