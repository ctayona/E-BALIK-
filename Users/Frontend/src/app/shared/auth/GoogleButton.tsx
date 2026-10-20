import { useEffect, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

/**
 * The "Continue with Google" button, drawn by Google inside an iframe.
 *
 * Three things keep it looking right (it used to turn into a pill on a white rectangle after the first render):
 *  - it is drawn ONCE per mount: the page can re-render as often as it likes, the sign-in callback is read through a ref, so the
 *    iframe is never torn down and rebuilt (each rebuild repainted it with a solid background);
 *  - the wrapper pins `color-scheme: light`: an iframe whose colour scheme differs from the page's (this app is dark) is painted on an
 *    opaque canvas, which is the white box that appeared around the pill;
 *  - the wrapper clips to the pill and the button is drawn at the wrapper's exact width, so nothing can show outside the pill.
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

export default function GoogleButton({ onCredential, failureHint }: {
  /** Called with Google's ID token, or undefined when the person closed the account chooser. */
  onCredential: (credential?: string) => void;
  /** Shown if the Google script cannot load, for example "You can still register with your UMak email." */
  failureHint: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;
  const [failed, setFailed] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return undefined;
    let active = true;
    loadGoogleScript().then(() => {
      const element = host.current;
      if (!active || !element || !window.google?.accounts) return;
      const width = Math.max(200, Math.min(400, Math.round(element.getBoundingClientRect().width) || 320));
      element.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential?: string }) => latest.current(response.credential),
      });
      window.google.accounts.id.renderButton(element, {
        theme: "outline", size: "large", text: "continue_with", shape: "pill", logo_alignment: "left", locale: "en", width,
      });
    }).catch(() => {
      if (active) {
        setFailed(true);
        showInfoModal({ variant: "warning", title: "Google sign-in unavailable", message: `The Google sign-in script failed to load. ${failureHint}` });
      }
    });
    return () => { active = false; };
  }, [clientId, failureHint]);

  if (!clientId) return null;
  if (failed) return <p className="text-center text-[13px] text-white/60">Google sign-in is unavailable right now.</p>;
  return (
    <div
      ref={host}
      style={{ colorScheme: "light" }}
      className="mx-auto flex h-[44px] w-full max-w-[400px] items-center justify-center overflow-hidden rounded-full"
      aria-label="Continue with Google"
    />
  );
}
