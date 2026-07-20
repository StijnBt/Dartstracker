import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin/members" element={<Members />} />
            <Route path="/admin/members/new" element={<NewMember />} />
            <Route path="/admin/members/:id/edit" element={<EditMember />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
