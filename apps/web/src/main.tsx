import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AccountBoundary } from './components/account-boundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountBoundary />
  </StrictMode>,
)
