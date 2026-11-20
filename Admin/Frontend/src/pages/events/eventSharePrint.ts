import posterCss from './eventSharePoster.css?inline';
import printCss from './eventSharePosterPrint.css?inline';

/** Print only the poster in an isolated document; preserve the admin's current page. */
export async function printEventPoster(poster: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.title = 'Event entry poster print preview';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
  document.body.append(frame);
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { if (cleanupTimer) clearTimeout(cleanupTimer); frame.remove(); };
  try {
    const doc = frame.contentDocument, target = frame.contentWindow;
    if (!doc || !target) throw new Error('Print preview is unavailable.');
    doc.open(); doc.write('<!doctype html><html><head><title>Event entry poster</title></head><body></body></html>'); doc.close();
    const style = doc.createElement('style'); style.textContent = posterCss + '\n' + printCss; doc.head.append(style);
    doc.body.append(doc.importNode(poster, true));
    await Promise.all([...doc.images].map((image) => image.decode()));
    target.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = setTimeout(cleanup, 120000);
    target.focus(); target.print();
  } catch (error) { cleanup(); throw error; }
}
