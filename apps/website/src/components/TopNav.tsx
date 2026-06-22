import { GITHUB_URL, NPM_VRF_CLIENT_URL } from "../data/constants";

/**
 * Slim sticky top nav. Brand returns to the landing page; the link group
 * surfaces the things people leave to find — the Claude skill, the npm
 * package, and the source. In-page anchors (#claude-skill) resolve to the
 * landing route from any sub-page via the hash router.
 */
export function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-800 bg-ink-950/80 backdrop-blur">
      <nav className="container-wide flex items-center justify-between py-3 text-sm">
        <a href="#/" className="font-mono font-semibold text-ink-50">
          cc-vrf
        </a>
        <div className="flex items-center gap-5 text-ink-300">
          <a className="hover:text-ink-50" href="#claude-skill">
            Claude skill
          </a>
          <a
            className="hover:text-ink-50"
            href={NPM_VRF_CLIENT_URL}
            target="_blank"
            rel="noreferrer"
          >
            npm
          </a>
          <a
            className="hover:text-ink-50"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
