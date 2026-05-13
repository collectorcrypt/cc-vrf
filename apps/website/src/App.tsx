import { Hero } from "./sections/Hero";
import { WhyWeMadeThis } from "./sections/WhyWeMadeThis";
import { HowItWorks } from "./sections/HowItWorks";
import { ClientDemo } from "./sections/ClientDemo";
import { WalletDemo } from "./sections/WalletDemo";
import { ServerSidePattern } from "./sections/ServerSidePattern";
import { CostComparison } from "./sections/CostComparison";
import { GetStarted } from "./sections/GetStarted";
import { Footer } from "./sections/Footer";
import { WalletProviders } from "./wallet/WalletProviders";

export function App() {
  return (
    <WalletProviders>
      <main className="flex min-h-screen flex-col gap-24 pb-24 pt-12 sm:pt-20">
        <Hero />
        <HowItWorks />
        <ClientDemo />
        <WalletDemo />
        <ServerSidePattern />
        <CostComparison />
        <GetStarted />
        <WhyWeMadeThis />
        <Footer />
      </main>
    </WalletProviders>
  );
}
