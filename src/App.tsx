import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Layout from "./components/Layout";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";
import SeasonStandings from "./pages/season/SeasonStandings";
import SeasonMatches from "./pages/season/SeasonMatches";
import NewSeason from "./pages/season/NewSeason";
import SeasonArchive from "./pages/season/SeasonArchive";
import SeasonDetail from "./pages/season/SeasonDetail";
import MatchResult from "./pages/season/MatchResult";
import LiveScoring from "./pages/season/LiveScoring";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Home />} />
              <Route path="/season" element={<Navigate to="/season/standings" replace />} />
              <Route path="/season/standings" element={<SeasonStandings />} />
              <Route path="/season/matches" element={<SeasonMatches />} />
              <Route path="/season/matches/:id/result" element={<MatchResult />} />
              <Route path="/season/matches/:id/live" element={<LiveScoring />} />
              <Route path="/seasons" element={<SeasonArchive />} />
              <Route path="/seasons/:id" element={<SeasonDetail />} />
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="/admin/members" element={<Members />} />
              <Route path="/admin/members/new" element={<NewMember />} />
              <Route path="/admin/members/:id/edit" element={<EditMember />} />
              <Route path="/season/new" element={<NewSeason />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
