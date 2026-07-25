import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";
import AnnouncementFeed from "./home/AnnouncementFeed";

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div>
      <div className="flex items-center gap-3 p-4">
        <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
        <h1 className="text-primary font-heading text-3xl font-bold">{branding.appName}</h1>
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <Link to="/season" className="text-primary underline">
              Season
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
      {user && <AnnouncementFeed />}
    </div>
  );
}
