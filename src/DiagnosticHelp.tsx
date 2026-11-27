import { useEffect, useState } from "react";
import { diagnosticReportId, downloadDiagnosticReport } from "./diagnostics";

export function DiagnosticHelp() {
  const [id, setId] = useState(diagnosticReportId);
  useEffect(() => {
    const update = () => setId(diagnosticReportId());
    window.addEventListener("elveria:diagnostics", update);
    return () => window.removeEventListener("elveria:diagnostics", update);
  }, []);
  return <div className="diagnostic-help">
    <p>Если загрузка не восстанавливается, скачайте отчёт и передайте его владельцу сайта. Он поможет разобраться в проблеме.</p>
    {id && <p>Код отчёта: <code>{id}</code></p>}
    <button type="button" className="button secondary" onClick={downloadDiagnosticReport}>Скачать отчёт об ошибке</button>
  </div>;
}
