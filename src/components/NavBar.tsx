import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

export default function NavBar() {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-3 p-4">
      <Link to="/" className="flex items-center gap-3">
        <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
        <h1 className="text-primary font-heading text-3xl font-bold">{branding.appName}</h1>
      </Link>
      {user && (
        <div className="ml-auto flex items-center gap-3">
          <Link to="/season/standings" className="text-primary underline">
            Standings
          </Link>
          <Link to="/season/matches" className="text-primary underline">
            Matches
          </Link>
          <Link to="/seasons" className="text-primary underline">
            Season Archive
          </Link>
          {user.role === "admin" && (
            <Link to="/admin/members" className="text-primary underline">
              Manage Members
            </Link>
          )}
          <span>{user.displayName}</span>
          <button onClick={() => void logout()} className="text-primary underline">
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
