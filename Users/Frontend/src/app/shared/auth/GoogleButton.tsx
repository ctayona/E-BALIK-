import { useEffect, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

/**
 * The "Continue with Google" button, drawn by Google inside an iframe.
 *
 * Google decides how its own button looks (a thin pill, logo pinned left, text off-centre), which never matched our "Log in" button.
 * So the VISIBLE button is ours (same height, radius, font and centring as the Log in button) and Google's real button sits on top of it,
 * invisible and stretched to cover it exactly, so a click still goes to Google. It is drawn once at Google's maximum width (400 x 40) and
 * only scaled with CSS when the container changes size, so it is never rebuilt.
 *
 * Three things keep it working (it used to turn into a pill on a white rectangle after the first render):
 *  - it is drawn ONCE per mount: the page can re-render as often as it likes, the sign-in callback is read through a ref, so the
 *    iframe is never torn down and rebuilt (each rebuild repainted it with a solid background);
 *  - the wrapper pins `color-scheme: light`: an iframe whose colour scheme differs from the page's (this app is dark) is painted on an
 *    opaque canvas, which is the white box that appeared around the pill;
 *  - the wrapper clips everything to our button's shape, so nothing can show outside it.
 * The button's language is fixed to English so it matches the rest of the sign-in form.
 */
declare global {
  interface Window {
    /** Google Identity Services, added by https://accounts.google.com/gsi/client. */
    google?: { accounts: { id: { initialize: (options: Record<string, unknown>) => void; renderButton: (element: HTMLElement, options: Record<string, unknown>) => void } } };
  }
}

let gsiPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client?hl=en";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => { gsiPromise = null; script.remove(); reject(new Error("Google script failed to load")); };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

const DRAW_WIDTH = 400;   // Google's largest button
const DRAW_HEIGHT = 40;   // Google's "large" height

const GoogleMark = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

export default function GoogleButton({ onCredential, failureHint, height = 52, radius = 12 }: {
  /** Called with Google's ID token, or undefined when the person closed the account chooser. */
  onCredential: (credential?: string) => void;
  /** Shown if the Google script cannot load, for example "You can still register with your UMak email." */
  failureHint: string;
  /** Matches the primary button next to it (the Log in button is 52 px). */
  height?: number;
  /** Corner radius in px, to match the button next to it. */
  radius?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return undefined;
    let active = true;
    loadGoogleScript().then(() => {
      const element = host.current;
      if (!active || !element || !window.google?.accounts) return;
      element.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential?: string }) => latest.current(response.credential),
      });
      window.google.accounts.id.renderButton(element, {
        theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", locale: "en", width: DRAW_WIDTH,
      });
    }).catch(() => {
      if (active) {
        setFailed(true);
        showInfoModal({ variant: "warning", title: "Google sign-in unavailable", message: `The Google sign-in script failed to load. ${failureHint}` });
      }
    });
    return () => { active = false; };
  }, [clientId, failureHint]);

  // Stretch Google's 400 x 40 button over our button, whatever size the container is (offsetWidth ignores the dialog's opening animation).
  useEffect(() => {
    const outer = box.current;
    const inner = host.current;
    if (!outer || !inner) return undefined;
    const fit = () => { inner.style.transform = `scale(${outer.offsetWidth / DRAW_WIDTH}, ${outer.offsetHeight / DRAW_HEIGHT})`; };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(outer);
    return () => watcher.disconnect();
  }, [clientId, failed]);

  if (!clientId) return null;
  if (failed) return <p className="text-center text-[13px] text-white/60">Google sign-in is unavailable right now.</p>;
  return (
    <div
      ref={box}
      style={{ height, borderRadius: radius, colorScheme: "light" }}
      className={`relative w-full overflow-hidden border bg-white transition-[border-color,box-shadow] duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-iris-500 ${hover ? "border-iris-300 shadow-[0_6px_18px_-10px_rgba(31,49,96,0.45)]" : "border-[#dbe3f0]"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Continue with Google"
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-[15px] font-semibold text-navy-800" aria-hidden="true">
        <GoogleMark />
        Continue with Google
      </span>
      <div ref={host} style={{ width: DRAW_WIDTH, height: DRAW_HEIGHT, transformOrigin: "0 0", opacity: 0.01 }} className="absolute left-0 top-0" />
    </div>
  );
}
