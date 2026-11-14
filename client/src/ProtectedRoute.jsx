import { Navigate, Outlet, useLocation } from "react-router-dom";

const ROLE_DASHBOARD_PATHS = {
  ADMIN: "/dashboard/admin",
  SBO_OFFICER: "/dashboard/officer",
  DEPARTMENT_HEAD: "/dashboard/department-head",
  STUDENT: "/dashboard/student",
};

function getStoredUser() {
  const rawUser = localStorage.getItem("user");
  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

// requireVenueBooking: an SBO officer gets in only while their position can book venues (user.can_book_venues).
export default function ProtectedRoute({ allowedRoles = null, requireVenueBooking = false, children = null }) {
  const token = localStorage.getItem("auth_token");
  const location = useLocation();
  const user = getStoredUser();
  const role = user?.role || null;

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (user?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    const fallback = ROLE_DASHBOARD_PATHS[role] || "/dashboard";
    // The dashboard reads this to say why the person landed there, and to offer their other profile that may open the page.
    return <Navigate to={fallback} replace state={{ accessDenied: { path: location.pathname + location.search, allowedRoles } }} />;
  }

  if (requireVenueBooking && role === "SBO_OFFICER" && user?.can_book_venues === false) {
    return <Navigate to={ROLE_DASHBOARD_PATHS.SBO_OFFICER} replace />;
  }

  return children || <Outlet />;
}
