import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";
import SeasonPage from "./pages/season/Season";
import NewSeason from "./pages/season/NewSeason";
import SeasonArchive from "./pages/season/SeasonArchive";
import SeasonDetail from "./pages/season/SeasonDetail";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/season" element={<SeasonPage />} />
            <Route path="/seasons" element={<SeasonArchive />} />
            <Route path="/seasons/:id" element={<SeasonDetail />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin/members" element={<Members />} />
            <Route path="/admin/members/new" element={<NewMember />} />
            <Route path="/admin/members/:id/edit" element={<EditMember />} />
            <Route path="/season/new" element={<NewSeason />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
