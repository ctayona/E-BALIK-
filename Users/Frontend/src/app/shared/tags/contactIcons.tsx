import { Facebook, Instagram, Mail, MessageCircle, MessageSquare, Phone, Send, Twitter } from "lucide-react";
import type { ContactKind } from "@/app/utils/tags";

/** One icon per contact method, used by the settings, the per-tag switches and the public scan page. */
export function ContactIcon({ kind, size = 18 }: { kind: ContactKind | string; size?: number }) {
  switch (kind) {
    case "phone2":
      return <Phone size={size} aria-hidden="true" />;
    case "email":
      return <Mail size={size} aria-hidden="true" />;
    case "facebook":
      return <Facebook size={size} aria-hidden="true" />;
    case "twitter":
      return <Twitter size={size} aria-hidden="true" />;
    case "instagram":
      return <Instagram size={size} aria-hidden="true" />;
    case "telegram":
      return <Send size={size} aria-hidden="true" />;
    case "whatsapp":
      return <MessageSquare size={size} aria-hidden="true" />;
    default:
      return <MessageCircle size={size} aria-hidden="true" />;
  }
}
