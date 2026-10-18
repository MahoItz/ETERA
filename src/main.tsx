import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RootErrorBoundary } from "./RootErrorBoundary";
import "./index.css";

const App = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <Suspense fallback={<main className="app-unavailable" aria-busy="true">Загружаем каталог…</main>}>
        <App />
      </Suspense>
    </RootErrorBoundary>
  </StrictMode>,
);
