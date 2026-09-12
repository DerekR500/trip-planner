import { Route, Routes } from 'react-router-dom'

import HomePage from './pages/HomePage'
import TripPage from './pages/TripPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/trip/:id" element={<TripPage />} />
    </Routes>
  )
}
