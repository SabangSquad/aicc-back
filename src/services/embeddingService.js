const baseURL = process.env.EMBEDDING_BASE_URL || process.env.VLLM_BASE_URL || "http://vllm:8000/v1";
const model = process.env.EMBEDDING_MODEL || "BAAI/bge-m3";
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS) || 1024;

/**
 * 텍스트를 임베딩 벡터로 변환 (OpenAI-호환 /v1/embeddings 엔드포인트)
 */
export async function generateEmbedding(text) {
  const url = `${baseURL.replace(/\/+$/, '')}/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text, dimensions }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Embedding API 오류 (${res.status}): ${body}`);
  }

  const json = await res.json();
  return json.data[0].embedding;
}
