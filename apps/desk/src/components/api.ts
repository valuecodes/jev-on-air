/** POSTs JSON and returns the parsed reply. Throws the server's error text. */
const postJson = async (path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
};

export { postJson };
