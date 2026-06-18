import { useEffect, useState } from "react";
import { Hero } from "./sections/Hero";
import { WhyWeMadeThis } from "./sections/WhyWeMadeThis";
import { HowItWorks } from "./sections/HowItWorks";
import { WhySecureEli5 } from "./sections/WhySecureEli5";
import { ModesComparison } from "./sections/ModesComparison";
import { ClientDemo } from "./sections/ClientDemo";
import { WalletDemo } from "./sections/WalletDemo";
import { CostComparison } from "./sections/CostComparison";
import { ClaudeSkill } from "./sections/ClaudeSkill";
import { GetStarted } from "./sections/GetStarted";
import { Tools } from "./sections/Tools";
import { Footer } from "./sections/Footer";
import { WalletProviders } from "./wallet/WalletProviders";
import { RegistryPage } from "./pages/RegistryPage";
import { EventsPage } from "./pages/EventsPage";
import { LookupPage } from "./pages/LookupPage";
import { VerifyPage } from "./pages/VerifyPage";

/**
 * Tiny hash-router: reads `window.location.hash` and re-renders on
 * `hashchange`. Anchors like `#cost` still work for in-page scroll —
 * those start with `#<name>` (no slash). Page routes use `#/<name>`.
 */
function useHashRoute(): string {
  const [hash, setHash] = useState<string>(
    typeof window === "undefined" ? "" : window.location.hash,
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function Landing() {
  return (
    <main className="flex min-h-screen flex-col gap-20 pb-24 pt-12 sm:pt-20">
      <Hero />
      <WhyWeMadeThis />
      <WhySecureEli5 />
      <HowItWorks />
      <ModesComparison />
      <CostComparison />
      <ClientDemo />
      <WalletDemo />
      <Tools />
      <ClaudeSkill />
      <GetStarted />
      <Footer />
    </main>
  );
}

export function App() {
  const hash = useHashRoute();

  // Scroll page routes to top when they change. In-page anchors keep their
  // browser-default behavior.
  useEffect(() => {
    if (hash.startsWith("#/")) {
      window.scrollTo({ top: 0 });
    }
  }, [hash]);

  let page: React.ReactNode;
  const path = hash.split("?")[0]; // route on the path; ignore deep-link query params
  if (path === "#/registry") page = <RegistryPage />;
  else if (path === "#/events") page = <EventsPage />;
  else if (path === "#/lookup") page = <LookupPage />;
  else if (path === "#/verify") page = <VerifyPage />;
  else page = <Landing />;

  return <WalletProviders>{page}</WalletProviders>;
}
