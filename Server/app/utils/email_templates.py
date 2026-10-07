"""Premium HTML email layout for every E-Balik message (Navy and Gold).

Email clients ignore most modern CSS, so the "glass" look is built from what they do support: a navy page, a card with
a translucent border and a navy gradient, gold hairlines and a large gold button. The layout is table based with inline
styles and a `bgcolor` fallback for every gradient, so it degrades to plain navy and gold in Outlook and older clients.

`render_email()` returns `(html, text)`. Every value is escaped here, so callers pass plain text only.
"""
import os
from html import escape
from typing import Dict, Iterable, List, Optional, Tuple

NAVY = '#1f3160'
NAVY_DEEP = '#0b1430'
NAVY_CARD = '#16224a'
GOLD = '#d1a153'
GOLD_LIGHT = '#ecc787'
INK = '#eef1f8'
INK_SOFT = '#b9c3dc'
INK_MUTED = '#8c99ba'
LINE = '#34437a'

SERIF = "Georgia, 'Times New Roman', serif"
SANS = "'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

# Tone colours for the accent bar and the highlight panel border.
TONES = {
    'default': GOLD,
    'success': '#4fc9a8',
    'warning': '#f5c451',
    'danger': '#f2788f',
}


def site_url(path: str = '') -> str:
    """The public address of the E-Balik site (PUBLIC_SITE_URL), used for the logo and the button."""
    base = (os.getenv('PUBLIC_SITE_URL') or 'http://localhost:5173').rstrip('/')
    return f"{base}/{path.lstrip('/')}" if path else base


def logo_url() -> str:
    return site_url('icons/icon-192.png')


def _paragraph(text: str) -> str:
    return f'<p style="margin:0 0 16px;font-family:{SANS};font-size:16px;line-height:26px;color:{INK_SOFT};">{escape(str(text))}</p>'


def _details(details: Dict[str, str]) -> str:
    rows = ''.join(
        f'<tr><td style="padding:10px 0;border-top:1px solid {LINE};font-family:{SANS};font-size:13px;color:{INK_MUTED};width:38%;vertical-align:top;">{escape(str(label))}</td>'
        f'<td style="padding:10px 0;border-top:1px solid {LINE};font-family:{SANS};font-size:15px;font-weight:600;color:{INK};vertical-align:top;word-break:break-word;">{escape(str(value))}</td></tr>'
        for label, value in (details or {}).items() if value
    )
    if not rows:
        return ''
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">{rows}</table>'


def _highlight(label: str, value: str, note: str, accent: str, big: bool) -> str:
    """The panel that holds the thing the reader must not miss: a code, a PIN or a reference."""
    size, spacing = ('44px', '10px') if big else ('24px', '1px')
    note_html = f'<p style="margin:12px 0 0;font-family:{SANS};font-size:13px;line-height:20px;color:{INK_SOFT};">{escape(note)}</p>' if note else ''
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;">'
        f'<tr><td align="center" bgcolor="#101a3d" style="padding:24px 16px;border:1.5px dashed {accent};border-radius:16px;background-color:#101a3d;'
        f'background-image:linear-gradient(180deg,rgba(209,161,83,0.14),rgba(209,161,83,0.04));">'
        f'<p style="margin:0 0 8px;font-family:{SANS};font-size:12px;letter-spacing:1.6px;color:{accent};font-weight:700;">{escape(label)}</p>'
        f'<p style="margin:0;font-family:{MONO};font-size:{size};line-height:1.15;letter-spacing:{spacing};font-weight:700;color:#ffffff;word-break:break-all;">{escape(value)}</p>'
        f'{note_html}</td></tr></table>'
    )


def _button(label: str, url: str) -> str:
    """A large, bulletproof button: a table cell carries the colour so it still shows when the link style is stripped."""
    return (
        f'<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:10px auto 26px;width:100%;">'
        f'<tr><td align="center" bgcolor="{GOLD}" style="border-radius:14px;background-color:{GOLD};'
        f'background-image:linear-gradient(180deg,{GOLD_LIGHT} 0%,{GOLD} 100%);">'
        f'<a href="{escape(url, quote=True)}" target="_blank" style="display:block;padding:20px 28px;font-family:{SANS};font-size:19px;font-weight:700;'
        f'line-height:24px;color:{NAVY_DEEP};text-decoration:none;border-radius:14px;">{escape(label)}</a></td></tr></table>'
    )


def render_email(
    *,
    title: str,
    paragraphs: Iterable[str],
    preheader: str = '',
    eyebrow: str = 'University of Makati',
    greeting: Optional[str] = None,
    highlight: Optional[Tuple[str, str]] = None,
    highlight_note: str = '',
    highlight_big: bool = True,
    details: Optional[Dict[str, str]] = None,
    cta: Optional[Tuple[str, str]] = None,
    notes: Optional[Iterable[str]] = None,
    tone: str = 'default',
    unsubscribe_url: str = '',
    unsubscribe_label: str = 'these emails',
) -> Tuple[str, str]:
    """Build the HTML and plain-text bodies. `cta` is `(label, absolute_url)`; `highlight` is `(label, value)`."""
    accent = TONES.get(tone, GOLD)
    paragraphs = [str(p) for p in paragraphs if p]
    notes = [str(n) for n in (notes or []) if n]

    body = ''
    if greeting:
        body += f'<p style="margin:0 0 14px;font-family:{SANS};font-size:17px;line-height:26px;color:{INK};font-weight:600;">{escape(greeting)}</p>'
    body += ''.join(_paragraph(p) for p in paragraphs)
    if highlight and highlight[1]:
        body += _highlight(highlight[0], highlight[1], highlight_note, accent, highlight_big)
    if details:
        body += _details(details)
    if cta:
        body += _button(cta[0], cta[1])
    if notes:
        body += ''.join(
            f'<p style="margin:0 0 8px;font-family:{SANS};font-size:13px;line-height:21px;color:{INK_MUTED};">{escape(n)}</p>' for n in notes
        )

    home = site_url()
    unsubscribe_html = ''
    if unsubscribe_url:
        unsubscribe_html = (
            f'<p style="margin:0 0 6px;font-family:{SANS};font-size:12px;line-height:19px;color:{INK_MUTED};">You get this because of your E-Balik notification settings. '
            f'<a href="{escape(unsubscribe_url, quote=True)}" style="color:{GOLD};text-decoration:underline;">Unsubscribe from {escape(unsubscribe_label)}</a>.</p>'
        )
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:{NAVY_DEEP};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader or title)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{NAVY_DEEP}" style="background-color:{NAVY_DEEP};background-image:linear-gradient(160deg,{NAVY_DEEP} 0%,{NAVY} 100%);">
<tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 6px 22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:14px;vertical-align:middle;"><img src="{escape(logo_url(), quote=True)}" width="52" height="52" alt="UMak seal" style="display:block;width:52px;height:52px;border-radius:26px;border:2px solid {GOLD};background-color:{NAVY};"></td>
        <td style="vertical-align:middle;">
          <p style="margin:0;font-family:{SERIF};font-size:27px;line-height:30px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">E-Balik</p>
          <p style="margin:2px 0 0;font-family:{SANS};font-size:12px;line-height:16px;color:{GOLD};letter-spacing:1.4px;">{escape(eyebrow)} &middot; LOST &amp; FOUND</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;line-height:3px;font-size:0;background-color:{accent};background-image:linear-gradient(90deg,{GOLD_LIGHT},{GOLD},rgba(209,161,83,0));border-radius:3px;">&nbsp;</td></tr>
    <tr><td bgcolor="{NAVY_CARD}" style="padding:34px 32px 30px;background-color:{NAVY_CARD};background-image:linear-gradient(165deg,#1d2c5e 0%,{NAVY_CARD} 55%,#121c40 100%);border:1px solid {LINE};border-top:0;border-radius:0 0 22px 22px;">
      <h1 style="margin:0 0 20px;font-family:{SERIF};font-size:30px;line-height:36px;font-weight:700;color:#ffffff;">{escape(title)}</h1>
      {body}
      <p style="margin:26px 0 0;padding-top:20px;border-top:1px solid {LINE};font-family:{SANS};font-size:14px;line-height:22px;color:{INK_SOFT};">With care,<br><strong style="color:{INK};">The E-Balik Team</strong><br><span style="color:{INK_MUTED};">Lost and Found Office, University of Makati</span></p>
    </td></tr>
    <tr><td align="center" style="padding:22px 14px 4px;">
      {unsubscribe_html}
      <p style="margin:0 0 6px;font-family:{SANS};font-size:12px;line-height:19px;color:{INK_MUTED};">We will never ask for your password or a verification code by email, chat or phone.</p>
      <p style="margin:0;font-family:{SANS};font-size:12px;line-height:19px;color:{INK_MUTED};"><a href="{escape(home, quote=True)}" style="color:{GOLD};text-decoration:none;">Open E-Balik</a> &nbsp;&middot;&nbsp; <a href="{escape(site_url('privacy'), quote=True)}" style="color:{GOLD};text-decoration:none;">Data privacy</a> &nbsp;&middot;&nbsp; ebaliksupport@gmail.com &nbsp;&middot;&nbsp; &copy; University of Makati</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""

    text_lines: List[str] = ['E-BALIK LOST & FOUND - University of Makati', '', title.upper(), '']
    if greeting:
        text_lines += [greeting, '']
    for paragraph in paragraphs:
        text_lines += [paragraph, '']
    if highlight and highlight[1]:
        text_lines += [f'{highlight[0]}: {highlight[1]}']
        if highlight_note:
            text_lines += [highlight_note]
        text_lines += ['']
    for label, value in (details or {}).items():
        if value:
            text_lines.append(f'{label}: {value}')
    if details:
        text_lines.append('')
    if cta:
        text_lines += [f'{cta[0]}: {cta[1]}', '']
    text_lines += list(notes)
    text_lines += ['', 'With care,', 'The E-Balik Team', 'Lost and Found Office, University of Makati',
                   'We will never ask for your password or a verification code by email, chat or phone.']
    if unsubscribe_url:
        text_lines += ['', f'Unsubscribe from {unsubscribe_label}: {unsubscribe_url}']
    return html, '\n'.join(text_lines).strip() + '\n'
