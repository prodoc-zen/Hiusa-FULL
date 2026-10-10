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

export default function ProtectedRoute({ allowedRoles = null, children = null }) {
  const token = localStorage.getItem("auth_token");
  const location = useLocation();
  const user = getStoredUser();
  const role = user?.role || null;

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    const fallback = ROLE_DASHBOARD_PATHS[role] || "/dashboard";
    return <Navigate to={fallback} replace />;
  }

  return children || <Outlet />;
}
