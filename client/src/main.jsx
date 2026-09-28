import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import './index.css'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        gap={10}
        closeButton
        icons={{
          success: <CheckCircle2 size={18} className="text-success-strong" aria-hidden="true" />,
          error: <AlertCircle size={18} className="text-danger-strong" aria-hidden="true" />,
          warning: <AlertTriangle size={18} className="text-warning-strong" aria-hidden="true" />,
          info: <Info size={18} className="text-brand-700" aria-hidden="true" />,
          loading: <Loader2 size={18} className="animate-spin text-ink-muted" aria-hidden="true" />,
        }}
        style={{
          '--normal-bg': 'var(--color-surface)',
          '--normal-border': 'var(--color-line)',
          '--normal-text': 'var(--color-ink)',
        }}
        toastOptions={{
          classNames: {
            toast: '!items-start !gap-3 !shadow-raised font-sans',
            title: '!text-sm !font-bold !text-ink',
            description: '!mt-0.5 !text-xs !font-medium !text-ink-muted',
            actionButton: '!ml-2 !inline-flex !h-8 !shrink-0 !items-center !rounded-control !bg-brand-700 !px-3 !text-xs !font-bold !text-white hover:!bg-brand-800',
            cancelButton: '!ml-2 !inline-flex !h-8 !shrink-0 !items-center !rounded-control !border !border-line !bg-surface !px-3 !text-xs !font-bold !text-ink hover:!bg-subtle',
            closeButton: 'hover:!bg-subtle hover:!border-line',
          },
        }}
      />
    </BrowserRouter>
  </StrictMode>,
)
