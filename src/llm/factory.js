const { ChatOpenAI, AzureChatOpenAI } = require("@langchain/openai");
const { ChatBedrockConverse } = require("@langchain/aws");
const { ChatOllama } = require("@langchain/ollama");

function validateConfig(config) {
  if (config.backend === "openai" && !config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is required when LLM_BACKEND=openai");
  }

  if (config.backend === "bedrock" && !config.bedrock.region) {
    throw new Error("AWS_REGION is required when LLM_BACKEND=bedrock");
  }

  if (config.backend === "azure") {
    if (!config.azure.apiKey) {
      throw new Error("AZURE_OPENAI_API_KEY is required when LLM_BACKEND=azure");
    }
    if (!config.azure.deploymentName) {
      throw new Error("AZURE_OPENAI_API_DEPLOYMENT_NAME is required when LLM_BACKEND=azure");
    }
    if (!config.azure.instanceName && !config.azure.basePath) {
      throw new Error("Set AZURE_OPENAI_API_INSTANCE_NAME or AZURE_OPENAI_BASE_PATH when LLM_BACKEND=azure");
    }
  }

  if (config.backend === "ollama") {
    if (!config.ollama.baseUrl) {
      throw new Error("OLLAMA_BASE_URL is required when LLM_BACKEND=ollama");
    }
    if (!config.ollama.model) {
      throw new Error("OLLAMA_MODEL is required when LLM_BACKEND=ollama");
    }
  }

  if (config.backend === "acp" && !config.acp.command) {
    throw new Error("ACP_COMMAND is required when LLM_BACKEND=acp");
  }
}

function createChatModel(config) {
  validateConfig(config);

  if (config.backend === "openai") {
    return new ChatOpenAI({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      temperature: 0.2,
      supportsStrictToolCalling: true
    });
  }

  if (config.backend === "bedrock") {
    return new ChatBedrockConverse({
      region: config.bedrock.region,
      model: config.bedrock.model,
      temperature: 0.2,
      toolChoice: "auto"
    });
  }

  if (config.backend === "ollama") {
    return new ChatOllama({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.model,
      temperature: 0.2
    });
  }

  return new AzureChatOpenAI({
    azureOpenAIApiKey: config.azure.apiKey,
    azureOpenAIApiInstanceName: config.azure.instanceName,
    azureOpenAIApiDeploymentName: config.azure.deploymentName,
    azureOpenAIApiVersion: config.azure.apiVersion,
    azureOpenAIBasePath: config.azure.basePath,
    temperature: 0.2,
    supportsStrictToolCalling: true
  });
}

module.exports = { createChatModel };
