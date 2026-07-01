import { HydratedRouter } from "react-router/dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

// Only apply the /apps/submit basename when the browser is actually
// on a proxied URL. Embedded admin routes (no prefix) are unaffected.
const basename = window.location.pathname.startsWith("/apps/submit")
  ? "/apps/submit"
  : undefined;

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter basename={basename} />
    </StrictMode>
  );
});