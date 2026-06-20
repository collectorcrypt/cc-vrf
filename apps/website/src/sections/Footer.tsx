import {
  GITHUB_URL,
  NPM_ECVRF_URL,
  NPM_VRF_CLIENT_URL,
} from "../data/constants";

export function Footer() {
  return (
    <footer className="container-wide mt-12 border-t border-ink-800 pt-8">
      <div className="flex flex-col items-start justify-between gap-4 text-sm text-ink-400 sm:flex-row">
        <div>
          <span className="font-mono text-ink-200">cc-vrf</span> &mdash;{" "}
          permissionless on-chain VRF for Solana &middot; MIT licensed.
        </div>
        <nav className="flex flex-wrap items-center gap-4">
          <a className="hover:text-ink-200" href={GITHUB_URL}>
            GitHub
          </a>
          <a
            className="hover:text-ink-200"
            href={NPM_ECVRF_URL}
            target="_blank"
            rel="noreferrer"
          >
            npm: ecvrf
          </a>
          <a
            className="hover:text-ink-200"
            href={NPM_VRF_CLIENT_URL}
            target="_blank"
            rel="noreferrer"
          >
            npm: vrf-client
          </a>
          <a className="hover:text-ink-200" href="#client-demo">
            Demo
          </a>
          <a className="hover:text-ink-200" href="#cost">
            Cost chart
          </a>
          <a className="hover:text-ink-200" href="#get-started">
            Get started
          </a>
          <a className="hover:text-ink-200" href="#references">
            References
          </a>
        </nav>
      </div>
    </footer>
  );
}
