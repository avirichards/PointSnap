/** Server-to-server credential. Never expose through NEXT_PUBLIC variables. */
export function workerHeaders(userId?: string): Record<string, string> {
  const token = process.env.POINTSNAP_WORKER_TOKEN;
  if (!token) throw new Error("Airline services are not configured yet.");
  return {
    Authorization: `Bearer ${token}`,
    ...(userId ? { "X-PointSnap-User": userId } : {}),
  };
}
export function workerConfigured() {
  return (
    !!process.env.PYTHON_WORKER_URL && !!process.env.POINTSNAP_WORKER_TOKEN
  );
}
