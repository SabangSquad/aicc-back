import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });

/**
 * 텍스트를 Bedrock Titan Embed v2로 1024차원 벡터로 변환
 */
export async function generateEmbedding(text) {
  const command = new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const res = await client.send(command);
  return JSON.parse(new TextDecoder().decode(res.body)).embedding;
}
