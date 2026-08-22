export async function loadSample(name: string): Promise<Uint8Array> {
  const res = await fetch(`/samples/${name}`);
  if (!res.ok) {
    throw new Error(`could not load sample (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
