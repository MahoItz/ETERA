import { createContext, useContext } from "react";
import { ShieldCheck } from "lucide-react";

export const AdminModeContext = createContext(false);

export function AdminModeIndicator() {
  const admin = useContext(AdminModeContext);
  if (!admin) return null;

  return (
    <span className="admin-mode-indicator" role="img" aria-label="Режим администратора" title="Режим администратора">
      <ShieldCheck size={18} aria-hidden="true" />
    </span>
  );
}
