import { Navigate, Outlet } from "react-router-dom";

export default function LoggedInRoute() {
  const token = localStorage.getItem("auth_token");
  return token ? <Navigate to="/dashboard" replace /> : <Outlet />;
}