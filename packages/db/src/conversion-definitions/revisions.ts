// Public entry point. Implementation is organized by responsibility.
export { getConversionDefinitionDeleteImpact, currentDefinitionForMutation, requireExpectedDefinition, stopConversionDefinition, configOf } from './revisions-mutation-guards.js';
export { reviseConversionDefinition, replaceConversionDefinitionUsages } from './revisions-replace.js';
export { deleteUnusedConversionDefinition, publishConversionDefinition } from './revisions-lifecycle.js';
