/**
 * What the home page tells people about the Lost and Found Office. One place to change it.
 * The address and the hotline are the ones already printed in the claim and approval screens. The opening hours are NOT recorded anywhere
 * else in the project: confirm them with the office, then set VITE_OFFICE_HOURS (or change the fallback below).
 */
export const OFFICE = {
  name: "UMak Lost and Found Office",
  address: "Admin Building, Ground Floor, OHSO Office",
  securityDesk: "Security Office behind the Oval Stadium",
  hours: (import.meta.env.VITE_OFFICE_HOURS as string | undefined) || "Mon to Fri, 8:00 AM to 5:00 PM",
  hotline: "09478685684",
  email: "ebaliksupport@gmail.com",
} as const;

export const hotlineHref = `tel:${OFFICE.hotline}`;
