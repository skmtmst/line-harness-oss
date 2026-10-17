// Public entry point. Implementation is organized by responsibility.
export { getConversionDefinitionDeleteImpact, currentDefinitionForMutation, requireExpectedDefinition, stopConversionDefinition, configOf } from './conversion-definitions-revisions-mutation-guards.js';
export { reviseConversionDefinition, replaceConversionDefinitionUsages } from './conversion-definitions-revisions-replace.js';
export { deleteUnusedConversionDefinition, publishConversionDefinition } from './conversion-definitions-revisions-lifecycle.js';
