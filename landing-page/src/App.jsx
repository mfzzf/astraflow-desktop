/* eslint-disable @next/next/no-img-element -- This standalone Vite app does not use next/image. */
import { useEffect, useMemo, useRef, useState } from "react";
import { RELEASE, SITE_LINKS } from "./release.js";

const NAV_ITEMS = [
  { label: "Product", href: SITE_LINKS.repository, external: true },
  { label: "Releases", href: SITE_LINKS.release, external: true },
  { label: "Support", href: `mailto:${SITE_LINKS.supportEmail}` },
  { label: "Downloads", href: "#downloads" },
];

function useHeaderState() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return scrolled;
}

function usePreferredDownload() {
  const fallback = RELEASE.downloads.macArm;
  const [preferred, setPreferred] = useState(fallback);

  useEffect(() => {
    let active = true;

    async function detectPlatform() {
      const userAgent = navigator.userAgent.toLowerCase();
      let result = fallback;

      if (userAgent.includes("windows")) {
        result = RELEASE.downloads.windows;
      } else if (userAgent.includes("linux") && !userAgent.includes("android")) {
        result = RELEASE.downloads.linux;
      } else if (userAgent.includes("mac")) {
        result = RELEASE.downloads.macArm;
      }

      if (navigator.userAgentData?.getHighEntropyValues) {
        try {
          const details = await navigator.userAgentData.getHighEntropyValues([
            "architecture",
            "platform",
          ]);
          const platform = details.platform?.toLowerCase() ?? "";
          const architecture = details.architecture?.toLowerCase() ?? "";

          if (platform.includes("mac")) {
            result = architecture.includes("x86")
              ? RELEASE.downloads.macIntel
              : RELEASE.downloads.macArm;
          } else if (platform.includes("win")) {
            result = RELEASE.downloads.windows;
          } else if (platform.includes("linux")) {
            result = RELEASE.downloads.linux;
          }
        } catch {
          // The browser may decline high-entropy details; the fallback stays valid.
        }
      }

      if (active) setPreferred(result);
    }

    detectPlatform();
    return () => {
      active = false;
    };
  }, [fallback]);

  return preferred;
}

function BrandLogo({ footer = false }) {
  return (
    <img
      className={footer ? "brand-logo brand-logo--footer" : "brand-logo"}
      src="/brand/astraflow-logo.png"
      alt="AstraFlow"
    />
  );
}

function Header({ preferredDownload }) {
  const scrolled = useHeaderState();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuToggleRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    const pageRegions = document.querySelectorAll(
      ".download-hero, .download-platforms, .site-footer",
    );
    pageRegions.forEach((region) => {
      region.inert = menuOpen;
    });

    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousFocus = document.activeElement;
    const menu = menuRef.current;
    const focusableItems = [
      ...(menu?.querySelectorAll("a[href], button:not([disabled])") ?? []),
      menuToggleRef.current,
    ].filter(Boolean);

    focusableItems[0]?.focus();

    const handleMenuKeys = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }

      if (event.key !== "Tab" || focusableItems.length === 0) return;
      const currentIndex = focusableItems.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusableItems.length - 1
          : currentIndex - 1
        : currentIndex >= focusableItems.length - 1
          ? 0
          : currentIndex + 1;

      event.preventDefault();
      focusableItems[nextIndex].focus();
    };

    window.addEventListener("keydown", handleMenuKeys);
    return () => {
      window.removeEventListener("keydown", handleMenuKeys);
      if (previousFocus instanceof HTMLElement && previousFocus.offsetParent !== null) {
        previousFocus.focus();
      } else {
        document.querySelector(".brand-link")?.focus();
      }
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1025px)");
    const closeAtDesktopWidth = () => {
      if (desktopQuery.matches) setMenuOpen(false);
    };

    desktopQuery.addEventListener("change", closeAtDesktopWidth);
    return () => desktopQuery.removeEventListener("change", closeAtDesktopWidth);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="brand-link" href="#top" aria-label="AstraFlow home">
            <BrandLogo />
          </a>

          <div className="nav-center">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noreferrer" : undefined}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="nav-actions">
            <a
              className="button button--secondary nav-github"
              href={SITE_LINKS.repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a className="button button--primary nav-download" href={preferredDownload.url}>
              Download
            </a>
            <button
              ref={menuToggleRef}
              className="menu-toggle"
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-controls="mobile-menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <img src="/icons/menu.svg" alt="" aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>

      <div
        ref={menuRef}
        id="mobile-menu"
        className={`mobile-menu${menuOpen ? " is-open" : ""}`}
        role="dialog"
        aria-label="Site navigation"
        aria-modal={menuOpen ? "true" : undefined}
        aria-hidden={!menuOpen}
        inert={!menuOpen ? true : undefined}
      >
        <div className="mobile-menu__links">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noreferrer" : undefined}
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="mobile-menu__actions">
          <a
            className="button button--secondary"
            href={SITE_LINKS.repository}
            target="_blank"
            rel="noreferrer"
            onClick={closeMenu}
            tabIndex={menuOpen ? 0 : -1}
          >
            GitHub
          </a>
          <a
            className="button button--primary"
            href={preferredDownload.url}
            onClick={closeMenu}
            tabIndex={menuOpen ? 0 : -1}
          >
            Download
          </a>
        </div>
      </div>
    </>
  );
}

function DownloadGlyph({ compact = false }) {
  return (
    <img
      className={compact ? "download-glyph download-glyph--compact" : "download-glyph"}
      src={compact ? "/icons/download-row.svg" : "/icons/download-primary.svg"}
      alt=""
      aria-hidden="true"
    />
  );
}

function DownloadRow({ download }) {
  return (
    <a className="download-row" href={download.url}>
      <span>
        <strong>{download.platform}</strong>{" "}
        <span>{download.detail}</span>
        <span className="download-size"> · {download.size}</span>
      </span>
      <DownloadGlyph compact />
    </a>
  );
}

function PlatformCard({ icon, name, downloads }) {
  return (
    <article className="platform-card" aria-label={name}>
      <h2 className="platform-card__title">
        <img src={icon} alt="" aria-hidden="true" />
        {name}
      </h2>
      <div className="platform-card__downloads">
        {downloads.map((download) => (
          <DownloadRow key={download.key} download={download} />
        ))}
      </div>
    </article>
  );
}

function Footer({ preferredDownload, onMachineView }) {
  return (
    <footer className="site-footer">
      <section className="footer-cta" aria-labelledby="footer-cta-title">
        <div className="footer-cta__content">
          <h2 id="footer-cta-title">Get started with AstraFlow.</h2>
          <a className="button button--light" href={preferredDownload.url}>
            Download now
          </a>
        </div>
      </section>

      <div className="footer-links">
        <div className="footer-links__grid">
          <a className="footer-brand" href="#top" aria-label="AstraFlow home">
            <BrandLogo footer />
          </a>

          <div className="footer-column">
            <p>Product</p>
            <a href="#downloads">Download</a>
            <a href={SITE_LINKS.release} target="_blank" rel="noreferrer">
              Release notes
            </a>
            <a href={SITE_LINKS.repository} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>

          <div className="footer-column">
            <p>Company</p>
            <a href="https://www.ucloud.cn/" target="_blank" rel="noreferrer">
              UCloud
            </a>
            <a href={`mailto:${SITE_LINKS.supportEmail}`}>Support</a>
          </div>

          <div className="footer-column">
            <p>Connect</p>
            <a href={SITE_LINKS.repository} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>

        <div className="footer-meta">
          <span>Copyright © 2026 UCloud</span>
          <span>AstraFlow {RELEASE.version}</span>
        </div>
      </div>

      <button className="view-toggle" type="button" onClick={onMachineView}>
        <span aria-hidden="true" /> MACHINE
      </button>
    </footer>
  );
}

function MachineView({ onHumanView }) {
  return (
    <main className="machine-view">
      <article>
        <p># Download AstraFlow — Desktop AI workspace</p>
        <p>
          &gt; Download AstraFlow for macOS, Windows, or Linux. Built-in agents,
          ModelVerse models, skills, MCP tools, and local or remote sandboxes.
        </p>
        <p>
          - URL: {window.location.href}
          <br />- Site: <a href="#top">[Home]</a> ·{" "}
          <a href={SITE_LINKS.repository}>[GitHub]</a> ·{" "}
          <a href={SITE_LINKS.release}>[Release]</a> ·{" "}
          <a href="#downloads">[Download]</a>
        </p>
        <p>---</p>
        <p>### Download AstraFlow</p>
        <p>
          <a href={RELEASE.downloads.macArm.url}>[Download for macOS]</a>
        </p>
        <p>#### macOS</p>
        <p>
          <a href={RELEASE.downloads.macArm.url}>[macOS Apple Silicon]</a>
          <br />
          <a href={RELEASE.downloads.macIntel.url}>[macOS Intel x64]</a>
        </p>
        <p>#### Windows</p>
        <p>
          <a href={RELEASE.downloads.windows.url}>[Windows x64 installer]</a>
        </p>
        <p>#### Linux</p>
        <p>
          <a href={RELEASE.downloads.linux.url}>[Linux x64 AppImage]</a>
        </p>
        <p>
          Version {RELEASE.version} · Released {RELEASE.releaseDate} · Copyright ©
          2026 UCloud
        </p>
      </article>
      <button className="machine-toggle" type="button" onClick={onHumanView}>
        <span aria-hidden="true" /> HUMAN
      </button>
    </main>
  );
}

export function App() {
  const preferredDownload = usePreferredDownload();
  const [machineView, setMachineView] = useState(
    () => window.localStorage.getItem("astraflow-view-mode") === "machine",
  );

  useEffect(() => {
    window.localStorage.setItem("astraflow-view-mode", machineView ? "machine" : "human");
    document.body.classList.toggle("is-machine-view", machineView);
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => document.body.classList.remove("is-machine-view");
  }, [machineView]);

  const platformCards = useMemo(
    () => [
      {
        name: "macOS",
        icon: "/icons/apple.svg",
        downloads: [RELEASE.downloads.macArm, RELEASE.downloads.macIntel],
      },
      {
        name: "Windows",
        icon: "/icons/windows.svg",
        downloads: [RELEASE.downloads.windows],
      },
      {
        name: "Linux",
        icon: "/icons/linux.svg",
        downloads: [RELEASE.downloads.linux],
      },
    ],
    [],
  );

  if (machineView) {
    return <MachineView onHumanView={() => setMachineView(false)} />;
  }

  return (
    <main id="top" className="download-page">
      <Header preferredDownload={preferredDownload} />

      <section className="download-hero" aria-labelledby="download-title">
        <div className="content-width">
          <h1 id="download-title">Download AstraFlow</h1>
          <a className="button button--primary primary-download" href={preferredDownload.url}>
            {preferredDownload.primaryLabel}
            <DownloadGlyph />
          </a>
        </div>
      </section>

      <section id="downloads" className="download-platforms" aria-label="Available downloads">
        <div className="platform-grid">
          {platformCards.map((platform) => (
            <PlatformCard key={platform.name} {...platform} />
          ))}
        </div>
      </section>

      <Footer
        preferredDownload={preferredDownload}
        onMachineView={() => setMachineView(true)}
      />
    </main>
  );
}
