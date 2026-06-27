import { Navigate, Outlet } from "react-router-dom";

function getUserRole() {
  const rawUser = localStorage.getItem("user");
  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser)?.role || null;
  } catch {
    return null;
  }
}

export default function ProtectedRoute({ allowedRoles = null, children = null }) {
  const token = localStorage.getItem("auth_token");
  const role = getUserRole();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    const fallback = role ? `/dashboard/${role}` : "/dashboard";
    return <Navigate to={fallback} replace />;
  }

  return children || <Outlet />;
}
