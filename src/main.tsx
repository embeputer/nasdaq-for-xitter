import { StrictMode, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DisclaimerPage } from './components/DisclaimerPage.tsx'

const page = window.location.pathname.startsWith('/disclaimer') ? DisclaimerPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {createElement(page)}
  </StrictMode>,
)
