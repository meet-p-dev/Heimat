import { createRoot } from 'react-dom/client'
import 'flag-icons/css/flag-icons.min.css'
import './index.css'
import App from './App'
import { LS } from './lib/storage'
import { initNative } from './lib/native'

// status bar / keyboard chrome before the first paint, so the shell never
// flashes the wrong colour on launch
const savedDark = LS.g<boolean>('mt-h-dark')
initNative(savedDark == null ? true : savedDark)

createRoot(document.getElementById('root')!).render(<App />)
