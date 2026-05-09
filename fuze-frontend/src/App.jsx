import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import TokenPage from "./pages/TokenPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/token/:poolAddress" element={<TokenPage />} />
      </Routes>
    </BrowserRouter>
  );
}