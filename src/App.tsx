import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PlayerApp from './PlayerApp';
import AdminApp from './admin/AdminApp';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<PlayerApp />} />
      </Routes>
    </BrowserRouter>
  );
}
