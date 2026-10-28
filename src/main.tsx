import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { isNative } from './native/platform'
import { setDocumentLang } from './i18n'
import { consumeAuthRedirect } from './lib/cloudSync'
import './index.css'

setDocumentLang()

// Android: route listeners first, so a notification tap that cold-started the app is not lost.
if (isNative) {
  void import('./native/init')
    .then(m => m.initNativeEarly())
    .catch(e => console.error('[native] early init failed', e))
}

// A cloud-sync magic link opened in the browser carries its tokens in the hash: claim them
// before the router sees the URL. Nothing to do on an ordinary launch.
void consumeAuthRedirect().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
