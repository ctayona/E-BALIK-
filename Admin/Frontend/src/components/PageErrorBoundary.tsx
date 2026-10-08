import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BTN } from "./ui/primitives";
import { tr } from "../utils/preferences";

/**
 * Keeps one broken page from blanking the whole console. The menu and header stay usable, the person is told what happened, and the
 * boundary resets when `resetKey` changes (the page they navigate to). Without this a render error unmounts the entire app.
 */
export default class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin page crashed:", error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="m-4 flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 sm:m-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600" aria-hidden="true"><AlertTriangle size={20} /></span>
        <div>
          <p className="font-[family-name:var(--font-heading)] text-[17px] font-semibold">{tr("This page ran into a problem")}</p>
          <p className="mt-1 max-w-[60ch] text-[14px] leading-6">{tr("The rest of the console still works. Reload to try again, or open another page from the menu. If it keeps happening, tell the developer which page it was.")}</p>
        </div>
        <button type="button" onClick={() => this.setState({ failed: false })} className={BTN.ghost}><RefreshCw size={16} aria-hidden="true" />{tr("Try again")}</button>
      </div>
    );
  }
}
