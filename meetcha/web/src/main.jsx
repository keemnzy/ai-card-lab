import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import "./styles/tokens.css";
import "./styles/app.css";
import { applyTheme } from "./lib/theme.js";
import { SessionProvider } from "./lib/session.jsx";
import { ToastProvider } from "./components/ui.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Verify from "./pages/Verify.jsx";
import Claim from "./pages/Claim.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Board, { BoardHome } from "./pages/Board.jsx";
import Person from "./pages/Person.jsx";
import Quiz from "./pages/Quiz.jsx";
import Recap from "./pages/Recap.jsx";
import Dex from "./pages/Dex.jsx";
import MyCard from "./pages/MyCard.jsx";
import Notes from "./pages/Notes.jsx";
import AdminEvents from "./admin/AdminEvents.jsx";
import AdminEvent from "./admin/AdminEvent.jsx";
import AdminReports from "./admin/AdminReports.jsx";
import Display from "./admin/Display.jsx";

applyTheme();

function ScrollTop() {
  const { pathname } = useLocation();
  // 최신 Chrome은 scrollTo가 Promise를 돌려주므로 반드시 중괄호로 감싼다 (정리 함수로 오인됨)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <SessionProvider>
      <ToastProvider>
        <ScrollTop />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/verify" element={<Verify />} />
          <Route path="/claim" element={<Claim />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/board" element={<BoardHome />} />
          <Route path="/events/:id" element={<Board />} />
          <Route path="/events/:id/recap" element={<Recap />} />
          <Route path="/u/:id" element={<Person />} />
          <Route path="/quiz/:userId" element={<Quiz />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/me" element={<MyCard />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/admin" element={<AdminEvents />} />
          <Route path="/admin/events/:id" element={<AdminEvent />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/display/:token" element={<Display />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </SessionProvider>
  </BrowserRouter>,
);
