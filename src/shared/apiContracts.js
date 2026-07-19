// @ts-check

const contractDefinitions = require("../../shared/contracts.json");

const API_CONTRACT_VERSION = contractDefinitions.contracts.api.version;
const API_CONTRACT_HEADER = contractDefinitions.contracts.api.header;
const TASK_SSE_CONTRACT_VERSION = contractDefinitions.contracts.taskSse.version;
const TASK_SSE_CONTRACT_HEADER = contractDefinitions.contracts.taskSse.header;
const TASK_SSE_CONTRACT_EVENT = contractDefinitions.contracts.taskSse.event;

function setApiContractHeaders(res) {
  res.setHeader(API_CONTRACT_HEADER, String(API_CONTRACT_VERSION));
}

function setTaskSseContractHeaders(res) {
  setApiContractHeaders(res);
  res.setHeader(TASK_SSE_CONTRACT_HEADER, String(TASK_SSE_CONTRACT_VERSION));
}

function createTaskSseContractPayload() {
  return {
    version: TASK_SSE_CONTRACT_VERSION,
    apiVersion: API_CONTRACT_VERSION
  };
}

function formatTaskSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function writeTaskSseEvent(res, event, data) {
  res.write(formatTaskSseEvent(event, data));
}

module.exports = {
  API_CONTRACT_HEADER,
  API_CONTRACT_VERSION,
  TASK_SSE_CONTRACT_EVENT,
  TASK_SSE_CONTRACT_HEADER,
  TASK_SSE_CONTRACT_VERSION,
  createTaskSseContractPayload,
  formatTaskSseEvent,
  setApiContractHeaders,
  setTaskSseContractHeaders,
  writeTaskSseEvent
};
