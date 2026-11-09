const PUBLIC_ROUTES = [
  "/login", "/forgot-password", "/reset-password", "/sign", "/rent",
  "/rto-sign", "/extend", "/setup", "/inspect", "/verify-payment",
  "/portal-signup", "/portal", "/runner-task", "/mechanic-job", "/work-order",
  "/part-quote", "/repair/accept", "/repair/decline", "/waitlist", "/add-driver", "/verify-card",
];

export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}