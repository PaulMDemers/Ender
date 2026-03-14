const { jiraToRepoWorkflow } = require("./jiraToRepoWorkflow");
// Copy workflowTemplate.js to a real workflow file, import it here, and add it below.

const workflowDefinitions = [
  jiraToRepoWorkflow
];

function getWorkflowDefinitions() {
  return workflowDefinitions;
}

module.exports = {
  workflowDefinitions,
  getWorkflowDefinitions
};
